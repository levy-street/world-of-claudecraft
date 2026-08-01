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
<<<<<<< HEAD
  it('passes no eager allocation to any frame trace scope', () => {
    const frame = findFrameFunction();
    const eagerAllocations: string[] = [];
    const finishedTraces: Array<{
      name: string;
      detailKeys: string[];
      detailValues: string[];
      finishesInFinally: boolean;
    }> = [];
=======
  it('delegates every frame trace scope to the reusable accounting helper', () => {
    const frame = findFrameFunction();
    const finishers: Array<{ name: string; finishesInFinally: boolean }> = [];
>>>>>>> b5f0d1f09de234121ffab1fdcf021f66e199a9b8

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
<<<<<<< HEAD
        node.expression.expression.getText(sourceFile) === 'perf' &&
        node.expression.name.text === 'finishTrace'
      ) {
        const name = node.arguments[0];
        const detailKeys = node.arguments
          .slice(2)
          .filter((_, index) => index % 2 === 0)
          .map((argument) => argument.getText(sourceFile).replaceAll("'", ''));
        const detailValues = node.arguments
          .slice(2)
          .filter((_, index) => index % 2 === 1)
          .map((argument) => argument.getText(sourceFile).replaceAll("'", ''));
=======
        node.expression.expression.getText(sourceFile) === 'framePerf' &&
        node.expression.name.text.startsWith('finish')
      ) {
>>>>>>> b5f0d1f09de234121ffab1fdcf021f66e199a9b8
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
<<<<<<< HEAD
        finishedTraces.push({
          name: name.getText(sourceFile).replaceAll("'", ''),
          detailKeys,
          detailValues,
          finishesInFinally,
        });
        for (const argument of node.arguments.slice(2)) {
          if (
            ts.isObjectLiteralExpression(argument) ||
            ts.isArrayLiteralExpression(argument) ||
            ts.isArrowFunction(argument) ||
            ts.isFunctionExpression(argument) ||
            ts.isTemplateExpression(argument)
          ) {
            eagerAllocations.push(argument.getText(sourceFile));
          }
        }
=======
        finishers.push({ name: node.expression.name.text, finishesInFinally });
>>>>>>> b5f0d1f09de234121ffab1fdcf021f66e199a9b8
      }
      ts.forEachChild(node, visit);
    };

    visit(frame);
<<<<<<< HEAD
    expect(finishedTraces).toEqual([
      {
        name: 'input.updateTouchLook',
        detailKeys: ['frameDtMs'],
        detailValues: ['frameDtMs'],
        finishesInFinally: true,
      },
      {
        name: 'input.gamepad',
        detailKeys: ['frameDtMs'],
        detailValues: ['frameDtMs'],
        finishesInFinally: true,
      },
      {
        name: 'input.hoverCursor',
        detailKeys: ['active'],
        detailValues: ['hoverActive'],
        finishesInFinally: true,
      },
      {
        name: 'sim.tick',
        detailKeys: ['mode'],
        detailValues: ['offline'],
        finishesInFinally: true,
      },
      {
        name: 'hud.handleEvents',
        detailKeys: ['mode', 'events'],
        detailValues: ['offline', 'eventsLength'],
        finishesInFinally: true,
      },
      {
        name: 'camera.follow',
        detailKeys: ['mode', 'frameDtMs'],
        detailValues: ['offline', 'frameDtMs'],
        finishesInFinally: true,
      },
      {
        name: 'renderer.sync',
        detailKeys: ['mode', 'views', 'alpha'],
        detailValues: ['offline', 'offlineViews', 'offlineAlpha'],
        finishesInFinally: true,
      },
      {
        name: 'ui.clickMoveMarker',
        detailKeys: [],
        detailValues: [],
        finishesInFinally: true,
      },
      {
        name: 'hud.update',
        detailKeys: ['mode'],
        detailValues: ['offline'],
        finishesInFinally: true,
      },
      {
        name: 'hud.handleEvents',
        detailKeys: ['mode', 'events'],
        detailValues: ['online', 'drainedEventsLength'],
        finishesInFinally: true,
      },
      {
        name: 'hud.setProfanityWords',
        detailKeys: ['words'],
        detailValues: ['profanityWordsLength'],
        finishesInFinally: true,
      },
      {
        name: 'hud.onInventoryChanged',
        detailKeys: [],
        detailValues: [],
        finishesInFinally: true,
      },
      {
        name: 'hud.onCosmeticsChanged',
        detailKeys: [],
        detailValues: [],
        finishesInFinally: true,
      },
      {
        name: 'camera.follow',
        detailKeys: ['mode', 'alpha', 'frameDtMs', 'lastSnapAge'],
        detailValues: ['online', 'alpha', 'frameDtMs', 'cameraLastSnapAge'],
        finishesInFinally: true,
      },
      {
        name: 'renderer.sync',
        detailKeys: ['mode', 'views', 'alpha', 'frameDtMs'],
        detailValues: ['online', 'onlineViews', 'alpha', 'frameDtMs'],
        finishesInFinally: true,
      },
      {
        name: 'ui.clickMoveMarker',
        detailKeys: [],
        detailValues: [],
        finishesInFinally: true,
      },
      {
        name: 'hud.update',
        detailKeys: ['mode'],
        detailValues: ['online'],
        finishesInFinally: true,
      },
    ]);
    expect(eagerAllocations).toEqual([]);
    expect(frame.getText(sourceFile)).not.toContain('perf.trace(');
    expect(frame.getText(sourceFile)).not.toContain('perf.time(');
=======
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
>>>>>>> b5f0d1f09de234121ffab1fdcf021f66e199a9b8

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
