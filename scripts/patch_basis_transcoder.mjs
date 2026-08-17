// Regenerate public/basis/ (basis_transcoder.js + .wasm) from three's
// vendored copy with the embind dynamic-code sites replaced by eval-free
// implementations.
//
// Why: KTX2Loader runs the transcoder inside a blob-URL worker, and a blob
// worker inherits the CSP of the page that created it. The Electron shell CSP
// (electron/shell_guards.cjs) allows 'wasm-unsafe-eval' but never
// 'unsafe-eval', so embind's code-generating sites (newFunc(Function, ...))
// throw EvalError inside the worker, the transcoder's ready promise never
// settles, and every KTX2-textured GLB load hangs: the v0.32.2/v0.32.3
// desktop "Loading world" freeze. The replacements below are the generic
// shapes Emscripten itself emits with -sDYNAMIC_EXECUTION=0.
//
// three 0.185.1's vendored transcoder (newer Emscripten) ships
// createNamedFunction already eval-free and dropped craftEmvalAllocator, so
// TWO dynamic sites remain: craftInvokerFunction (function declaration, new
// isAsync parameter) and __emval_get_method_caller (now an arrow with a kind
// parameter: 0 = method call on obj, 1 = construct, otherwise call with the
// first arg as receiver). Both build their function body as a string and run
// it through newFunc(Function, ...).
//
// Run after any three bump that changes the vendored transcoder:
//   node scripts/patch_basis_transcoder.mjs
// tests/glb_texture_compression.test.ts pins shipped === patch(vendored), and
// tests/basis_transcoder_csp.test.ts pins the no-dynamic-code invariant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const BANNER = `/* WoC local patch (see scripts/patch_basis_transcoder.mjs): the two embind
 * dynamic-code sites in three 0.185's vendored transcoder
 * (craftInvokerFunction, __emval_get_method_caller) are replaced with
 * eval-free generic implementations (what Emscripten emits with
 * -sDYNAMIC_EXECUTION=0), so the transcoder runs inside the Electron shell's
 * blob worker, whose inherited CSP has no 'unsafe-eval'. Re-vendoring this
 * file without re-running the patcher hangs every desktop GLB load.
 */
`;

// Faithful eval-free equivalents of the code each site GENERATES, against the
// same closure protocol (usesDestructorStack, throwBindingError,
// runDestructors, createNamedFunction, emval_lookupTypes, emval_returnValue,
// emval_addMethodCaller, reflectConstruct all exist in the vendored scope).
const SITES = [
  {
    name: 'craftInvokerFunction',
    marker: 'function craftInvokerFunction(',
    replacement: `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=usesDestructorStack(argTypes);var returns=argTypes[0].name!=="void";var expectedArgCount=argCount-2;var retType=argTypes[0];var classParam=argTypes[1];var invokerFn=function(){if(arguments.length!==expectedArgCount){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expectedArgCount)}var destructors=needsDestructorStack?[]:null;var callArgs=[cppTargetFunc];var thisWired=null;if(isClassMethodFunc){thisWired=classParam["toWireType"](destructors,this);callArgs.push(thisWired)}var argsWired=new Array(expectedArgCount);for(var i=0;i<expectedArgCount;++i){argsWired[i]=argTypes[i+2]["toWireType"](destructors,arguments[i]);callArgs.push(argsWired[i])}var rv=cppInvokerFunc.apply(null,callArgs);if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){var param=i===1?thisWired:argsWired[i-2];if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(param)}}}if(returns){return retType["fromWireType"](rv)}};return createNamedFunction(humanName,invokerFn)}`,
  },
  {
    name: '__emval_get_method_caller',
    marker: 'var __emval_get_method_caller=(argCount,argTypes,kind)=>',
    replacement: `var __emval_get_method_caller=(argCount,argTypes,kind)=>{var types=emval_lookupTypes(argCount,argTypes);var retType=types.shift();argCount--;var argN=argCount;var invokerFunction=function(obj,func,destructorsRef,args){var offset=0;var callArgs=new Array(argN);for(var i=0;i<argN;++i){callArgs[i]=types[i].readValueFromPointer(args+offset);offset+=types[i]["argPackAdvance"]}var rv;if(kind===1){rv=reflectConstruct(func,callArgs)}else if(kind===0){rv=func.apply(obj,callArgs)}else{rv=func.apply(callArgs[0],callArgs.slice(1))}if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}};var functionName="methodCaller<("+types.map(t=>t.name).join(", ")+") => "+retType.name+">";return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))}`,
  },
];

// The paren/arrow head is part of the marker so a prefix-renamed site (an
// upstream craftInvokerFunctionV2) throws "not found" instead of silently
// patching the wrong function and leaving dangling call sites behind a green
// pin.
function extractSite(source, marker, name) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`patch_basis_transcoder: ${name} not found`);
  if (source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`patch_basis_transcoder: ${name} is ambiguous`);
  }
  let depth = 0;
  let i = source.indexOf('{', start + marker.length - 1);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

/** Behavior-shaped scan for dynamic-code use of the Function constructor:
 *  matches `new Function(`, `newFunc(Function,`, and a bare `Function("...")`
 *  call, while skipping identifiers that merely end in Function (the file has
 *  dozens, e.g. createNamedFunction) and the `instanceof Function` check in
 *  the (dead after patching) newFunc helper, which never CALLS the
 *  constructor. */
export const DYNAMIC_FUNCTION_CALL = /(^|[^\w.$])Function\s*[(,]/;

/** Any eval reference at all, including indirect `(0,eval)(...)` and
 *  `globalThis.eval(...)`, both CSP-blocked exactly like the direct form.
 *  Callers strip the banner first ("eval-free", "unsafe-eval"). */
export const EVAL_REFERENCE = /\beval\b/;

/** Strip the WoC banner so the scans above see only transcoder code. */
export function withoutBanner(source) {
  return source.startsWith('/*') ? source.slice(source.indexOf('*/') + 2) : source;
}

/** Pure transform: three's vendored transcoder source in, patched source out.
 *  Throws when a site is missing or a dynamic-code marker survives, so a
 *  three bump that reshapes embind fails loudly instead of shipping evals. */
export function patchBasisTranscoderSource(source) {
  let out = source;
  for (const { name, marker, replacement } of SITES) {
    const original = extractSite(out, marker, name);
    if (!original.includes('newFunc(Function')) {
      throw new Error(
        `patch_basis_transcoder: ${name} has no dynamic-code marker; already patched?`,
      );
    }
    out = out.replace(original, replacement);
  }
  if (DYNAMIC_FUNCTION_CALL.test(out) || EVAL_REFERENCE.test(out)) {
    throw new Error('patch_basis_transcoder: dynamic-code markers remain after patching');
  }
  // Compile-only syntax check: the brace matcher above is string-literal
  // blind, so prove the spliced output still parses before anyone ships it
  // (never invoked; Function wraps the source as an uncalled function body).
  try {
    new Function(out);
  } catch (err) {
    throw new Error(`patch_basis_transcoder: patched output does not parse: ${err}`);
  }
  return BANNER + out;
}

/** Shared locations, so the pin test and the CLI cannot drift apart. */
export const VENDORED_TRANSCODER_DIR = [
  'node_modules',
  'three',
  'examples',
  'jsm',
  'libs',
  'basis',
];
export const SHIPPED_TRANSCODER_DIR = ['public', 'basis'];

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const vendored = path.join(ROOT, ...VENDORED_TRANSCODER_DIR, 'basis_transcoder.js');
  const shipped = path.join(ROOT, ...SHIPPED_TRANSCODER_DIR, 'basis_transcoder.js');
  const patched = patchBasisTranscoderSource(fs.readFileSync(vendored, 'utf8'));
  fs.writeFileSync(shipped, patched);
  console.log(`patched ${shipped} (${patched.length} chars) from three's vendored transcoder`);
  // The wasm pairs with its glue: ship the matching binary in the same run so
  // a JS regen can never leave a mismatched module behind.
  const vendoredWasm = path.join(ROOT, ...VENDORED_TRANSCODER_DIR, 'basis_transcoder.wasm');
  const shippedWasm = path.join(ROOT, ...SHIPPED_TRANSCODER_DIR, 'basis_transcoder.wasm');
  fs.copyFileSync(vendoredWasm, shippedWasm);
  console.log(`copied ${shippedWasm} (${fs.statSync(shippedWasm).size} bytes)`);
}
