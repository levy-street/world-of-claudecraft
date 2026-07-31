// Regenerate public/basis/basis_transcoder.js from three's vendored copy with
// the embind dynamic-code sites replaced by eval-free implementations.
//
// Why: KTX2Loader runs the transcoder inside a blob-URL worker, and a blob
// worker inherits the CSP of the page that created it. The Electron shell CSP
// (electron/shell_guards.cjs) allows 'wasm-unsafe-eval' but never
// 'unsafe-eval', so embind's four code-generating sites (new Function, and
// new_(Function, ...)) throw EvalError inside the worker, the transcoder's
// ready promise never settles, and every KTX2-textured GLB load hangs: the
// v0.32.2/v0.32.3 desktop "Loading world" freeze. The replacements below are
// the generic shapes Emscripten itself emits with -sDYNAMIC_EXECUTION=0.
//
// Run after any three bump that changes the vendored transcoder:
//   node scripts/patch_basis_transcoder.mjs
// tests/glb_texture_compression.test.ts pins shipped === patch(vendored), and
// tests/basis_transcoder_csp.test.ts pins the no-dynamic-code invariant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const BANNER = `/* WoC local patch (see scripts/patch_basis_transcoder.mjs): the four embind
 * dynamic-code sites (createNamedFunction, craftInvokerFunction,
 * craftEmvalAllocator, __emval_get_method_caller) are replaced with the
 * eval-free generic implementations (what Emscripten emits with
 * -sDYNAMIC_EXECUTION=0), so the transcoder runs inside the Electron shell's
 * blob worker, whose inherited CSP has no 'unsafe-eval'. Re-vendoring this
 * file without re-running the patcher hangs every desktop GLB load.
 */
`;

const REPLACEMENTS = {
  createNamedFunction: `function createNamedFunction(name,body){name=makeLegalFunctionName(name);var namedFunction=function(){"use strict";return body.apply(this,arguments)};try{Object.defineProperty(namedFunction,"name",{value:name})}catch(e){}return namedFunction}`,
  craftEmvalAllocator: `function craftEmvalAllocator(argCount){return function(constructor,argTypes,args){var argsArray=new Array(argCount);for(var i=0;i<argCount;++i){var argType=requireRegisteredType(Module["HEAP32"][(argTypes>>>2)+i],"parameter "+i);argsArray[i]=argType.readValueFromPointer(args);args+=argType["argPackAdvance"]}var obj=Reflect.construct(constructor,argsArray);return __emval_register(obj)}}`,
  craftInvokerFunction: `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var expectedArgCount=argCount-2;var invokerBody=function(){if(arguments.length!==expectedArgCount){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expectedArgCount+" args!")}var destructors=needsDestructorStack?[]:null;var dtorStack=needsDestructorStack?destructors:null;var callArgs=[cppTargetFunc];var thisWired=null;if(isClassMethodFunc){thisWired=argTypes[1].toWireType(dtorStack,this);callArgs.push(thisWired)}var argsWired=new Array(expectedArgCount);for(var i=0;i<expectedArgCount;++i){argsWired[i]=argTypes[i+2].toWireType(dtorStack,arguments[i]);callArgs.push(argsWired[i])}var rv=cppInvokerFunc.apply(null,callArgs);if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){var param=i===1?thisWired:argsWired[i-2];if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(param)}}}if(returns){return argTypes[0].fromWireType(rv)}};return createNamedFunction(makeLegalFunctionName(humanName),invokerBody)}`,
  __emval_get_method_caller: `function __emval_get_method_caller(argCount,argTypes){var types=__emval_lookupTypes(argCount,argTypes);var retType=types[0];var argN=argCount-1;var invokerFunction=function(handle,name,destructors,args){var offset=0;var callArgs=new Array(argN);for(var i=0;i<argN;++i){callArgs[i]=types[i+1].readValueFromPointer(args+offset);offset+=types[i+1]["argPackAdvance"]}var rv=handle[name].apply(handle,callArgs);for(var i=0;i<argN;++i){if(types[i+1]["deleteObject"]){types[i+1]["deleteObject"](callArgs[i])}}if(!retType.isVoid){return retType.toWireType(destructors,rv)}};return __emval_addMethodCaller(invokerFunction)}`,
};

function extractFunction(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`patch_basis_transcoder: ${name} not found`);
  if (source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`patch_basis_transcoder: ${name} is ambiguous`);
  }
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

/** Pure transform: three's vendored transcoder source in, patched source out.
 *  Throws when a site is missing or a dynamic-code marker survives, so a
 *  three bump that reshapes embind fails loudly instead of shipping evals. */
export function patchBasisTranscoderSource(source) {
  let out = source;
  for (const [name, replacement] of Object.entries(REPLACEMENTS)) {
    const original = extractFunction(out, name);
    if (!original.includes('new Function') && !original.includes('new_(Function')) {
      throw new Error(
        `patch_basis_transcoder: ${name} has no dynamic-code marker; already patched?`,
      );
    }
    out = out.replace(original, replacement);
  }
  if (out.includes('new Function') || out.includes('new_(Function')) {
    throw new Error('patch_basis_transcoder: dynamic-code markers remain after patching');
  }
  return BANNER + out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const vendored = path.join(
    ROOT,
    'node_modules',
    'three',
    'examples',
    'jsm',
    'libs',
    'basis',
    'basis_transcoder.js',
  );
  const shipped = path.join(ROOT, 'public', 'basis', 'basis_transcoder.js');
  const patched = patchBasisTranscoderSource(fs.readFileSync(vendored, 'utf8'));
  fs.writeFileSync(shipped, patched);
  console.log(`patched ${shipped} (${patched.length} chars) from three's vendored transcoder`);
}
