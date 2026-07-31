import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourcePath = path.resolve(process.cwd(), 'src/main.ts');
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true);
const perfSourcePath = path.resolve(process.cwd(), 'src/game/perf.ts');
const perfSourceText = fs.readFileSync(perfSourcePath, 'utf8');
const perfSourceFile = ts.createSourceFile(
  perfSourcePath,
  perfSourceText,
  ts.ScriptTarget.Latest,
  true,
);

function findFrameFunction(): ts.FunctionDeclaration {
  let frame: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'frame') {
      frame = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!frame) throw new Error('src/main.ts frame() was not found');
  return frame;
}

describe('client frame allocation guards', () => {
  it('delegates every frame trace scope to the reusable accounting helper', () => {
    const frame = findFrameFunction();
    const finishers: Array<{ name: string; finishesInFinally: boolean }> = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sourceFile) === 'framePerf' &&
        node.expression.name.text.startsWith('finish')
      ) {
        let ancestor: ts.Node | undefined = node.parent;
        let finishesInFinally = false;
        while (ancestor && ancestor !== frame) {
          if (
            ts.isBlock(ancestor) &&
            ts.isTryStatement(ancestor.parent) &&
            ancestor.parent.finallyBlock === ancestor
          ) {
            finishesInFinally = true;
            break;
          }
          ancestor = ancestor.parent;
        }
        finishers.push({ name: node.expression.name.text, finishesInFinally });
      }
      ts.forEachChild(node, visit);
    };

    visit(frame);
    expect(finishers).toEqual([
      { name: 'finishTouchLook', finishesInFinally: true },
      { name: 'finishGamepad', finishesInFinally: true },
      { name: 'finishHover', finishesInFinally: true },
      { name: 'finishSimTick', finishesInFinally: true },
      { name: 'finishEvents', finishesInFinally: true },
      { name: 'finishCamera', finishesInFinally: true },
      { name: 'finishRenderer', finishesInFinally: true },
      { name: 'finishClickMoveMarker', finishesInFinally: true },
      { name: 'finishHud', finishesInFinally: true },
      { name: 'finishEvents', finishesInFinally: true },
      { name: 'finishProfanityWords', finishesInFinally: true },
      { name: 'finishInventoryChanged', finishesInFinally: true },
      { name: 'finishCosmeticsChanged', finishesInFinally: true },
      { name: 'finishCamera', finishesInFinally: true },
      { name: 'finishRenderer', finishesInFinally: true },
      { name: 'finishClickMoveMarker', finishesInFinally: true },
      { name: 'finishHud', finishesInFinally: true },
    ]);
    expect(frame.getText(sourceFile)).not.toContain('perf.trace(');
    expect(frame.getText(sourceFile)).not.toContain('perf.time(');
    expect(frame.getText(sourceFile)).not.toContain('perf.finishTrace(');
    expect(frame.getText(sourceFile)).not.toContain('perf.finishTime(');

    const initializers = new Map<string, string>();
    const findInitializers = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined
      ) {
        initializers.set(node.name.text, node.initializer.getText(sourceFile).replace(/\s+/g, ' '));
      }
      ts.forEachChild(node, findInitializers);
    };
    findInitializers(frame);
    expect(
      Object.fromEntries(
        [
          'frameDtMs',
          'hoverActive',
          'eventsLength',
          'offlineAlpha',
          'offlineViews',
          'drainedEventsLength',
          'profanityWordsLength',
          'cameraLastSnapAge',
          'onlineViews',
        ].map((name) => [name, initializers.get(name)]),
      ),
    ).toEqual({
      frameDtMs: 'frameDt * 1000',
      hoverActive: 'input.hoverActive',
      eventsLength: 'events.length',
      offlineAlpha: 'acc / DT',
      offlineViews: 'renderer.views.size',
      drainedEventsLength: 'drainedEvents.length',
      profanityWordsLength: 'net.profanityWords.length',
      cameraLastSnapAge: 'net.lastSnapAt > 0 ? performance.now() - net.lastSnapAt : -1',
      onlineViews: 'renderer.views.size',
    });
  });

  it('contains no direct allocation expression on the animation-frame hot path', () => {
    const frame = findFrameFunction();
    const allocations: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isObjectLiteralExpression(node) ||
        ts.isArrayLiteralExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isTemplateExpression(node) ||
        ts.isNewExpression(node)
      ) {
        allocations.push(node.getText(sourceFile));
      }
      ts.forEachChild(node, visit);
    };

    visit(frame);
    expect(allocations).toEqual([]);
  });

  it('returns from disabled finishTrace before constructing its detail object', () => {
    let method: ts.MethodDeclaration | undefined;
    const findMethod = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) && node.name.getText(perfSourceFile) === 'finishTrace') {
        method = node;
        return;
      }
      ts.forEachChild(node, findMethod);
    };
    findMethod(perfSourceFile);
    if (!method?.body) throw new Error('PerfMonitor.finishTrace() was not found');

    const disabledReturn = method.body.statements.find(
      (statement): statement is ts.IfStatement =>
        ts.isIfStatement(statement) &&
        statement.expression.getText(perfSourceFile) === '!this.traceEnabled' &&
        ts.isReturnStatement(statement.thenStatement),
    );
    const detailObjects: ts.ObjectLiteralExpression[] = [];
    const findDetailObjects = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) detailObjects.push(node);
      ts.forEachChild(node, findDetailObjects);
    };
    findDetailObjects(method.body);

    expect(disabledReturn).toBeDefined();
    expect(detailObjects).toHaveLength(1);
    if (!disabledReturn || !detailObjects[0])
      throw new Error('finishTrace allocation order was not found');
    expect(disabledReturn.getStart(perfSourceFile)).toBeLessThan(
      detailObjects[0].getStart(perfSourceFile),
    );
  });

  it('reuses caller-owned hover membership sets', () => {
    expect(sourceText).toContain('activePvpOpponentIds(world, hoverPvpOpponentIds)');
    expect(sourceText).toContain('partyMemberIds(hoverPartyMemberIds)');

    let partyMemberIds: ts.FunctionDeclaration | undefined;
    const findPartyMemberIds = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'partyMemberIds') {
        partyMemberIds = node;
        return;
      }
      ts.forEachChild(node, findPartyMemberIds);
    };
    findPartyMemberIds(sourceFile);
    if (!partyMemberIds?.body) throw new Error('partyMemberIds() was not found');

    const helperText = partyMemberIds.getText(sourceFile);
    expect(helperText).toContain('ids.clear()');
    expect(helperText).toContain('return ids');
    expect(helperText).not.toContain('new Set');
  });
});
