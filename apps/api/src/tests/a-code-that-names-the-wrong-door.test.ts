/**
 * A step-up code must name the thing it authorises.
 *
 * `SECURITY.md` says step-up is "consumed on use — one code authorises exactly
 * one action". The consumption half holds: `consumeStepUpGrant` spends the row
 * under `FOR UPDATE SKIP LOCKED`. This file is about the other word. An action
 * is a *name*, and the name is what gets written down.
 *
 * `POST /devices/:id/block` and `/unblock` asked for `user.role.change`, on the
 * reasoning — stated in a comment above them — that taking a laptop off
 * somebody is "the same size of decision as changing an officer's role". The
 * size was right. Three things followed from the name being wrong:
 *
 *   `grantStepUp` audits the grant it writes. An officer who blocked a stolen
 *   laptop left an `auth.step_up_granted` row saying they had authenticated a
 *   role change — an authentication event naming an action that did not
 *   happen, in the table whose entire worth is that it does not do that.
 *
 *   The refusal told them so too: `requireStepUp` builds `nextStep` from the
 *   action, so an officer blocking a handset was instructed to step up for a
 *   role change.
 *
 *   And for the window's ten minutes the two doors took each other's keys. A
 *   code minted for routine handset admin would promote an account to admin;
 *   a code minted to block a machine already in somebody else's hands would
 *   hand it back. Routine actions sharing a name with rare ones is also how an
 *   officer learns to approve the prompt without reading it.
 *
 * WHAT THIS CHECKS, AND WHAT IT DOES NOT
 *
 * Every `requireStepUp('x.y.z')` must share a word with the route it guards.
 * That is a check on the *subject*, not on the verb, and deliberately so:
 * `audit.report.sign` also gates `/audit/reports/:id/withdraw`, and the note
 * beside it in `STEP_UP_ACTIONS` says why — "withdrawal is the other half of
 * the same authority". Grouping two operations on one subject under one name
 * is a judgement this repository makes on purpose. Gating a *device* route on
 * a *user* action is not that; it shares no word at all, and that is the line
 * drawn here.
 *
 * The list is also checked in the other direction, because it has been wrong
 * that way before: `STEP_UP_ACTIONS` named `user.role.change` and
 * `taxpayer.identity.change` for a long time while nothing performed either,
 * and an action nobody consumes is a control that exists only in a list.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STEP_UP_ACTIONS } from '@psirs/shared';

const ROUTES = 'src/routes';

interface Site {
  action: string;
  method: string;
  path: string;
  where: string;
}

/**
 * Every `requireStepUp(...)` in the route files, with the route it guards.
 *
 * The route declaration is found by walking back from the call to the nearest
 * `xRouter.<verb>(`, which is how all of them are written: the guards sit in
 * the argument list of the declaration they belong to, so the nearest one
 * above is always the right one.
 */
function stepUpSites(): Site[] {
  const sites: Site[] = [];
  for (const file of readdirSync(ROUTES).filter((n) => n.endsWith('.ts'))) {
    const lines = readFileSync(join(ROUTES, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const call = line.match(/requireStepUp\('([^']+)'\)/);
      if (!call) return;
      for (let back = index; back >= 0 && back > index - 40; back -= 1) {
        // `router.post('/path'` on one line, or `router.post(` with the path
        // on the next — both spellings appear.
        const inline = lines[back]!.match(/Router\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
        if (inline) {
          sites.push({
            action: call[1]!,
            method: inline[1]!.toUpperCase(),
            path: inline[2]!,
            where: `${file}:${index + 1}`,
          });
          return;
        }
        const split = lines[back]!.match(/Router\.(get|post|put|patch|delete)\(\s*$/);
        if (split) {
          const path = lines[back + 1]!.match(/'([^']+)'/);
          assert.ok(path, `${file}:${back + 2}: a route declaration with no path literal under it`);
          sites.push({
            action: call[1]!,
            method: split[1]!.toUpperCase(),
            path: path[1]!,
            where: `${file}:${index + 1}`,
          });
          return;
        }
      }
      assert.fail(`${file}:${index + 1}: requireStepUp with no route declaration above it`);
    });
  }
  return sites;
}

/**
 * Words, with a trailing plural dropped so `roles` meets `role`.
 *
 * Deliberately crude. The rule is "the officer would recognise this name as
 * being about this route", and a shared stem is as close as a machine gets to
 * that without a dictionary.
 */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length > 2 && word !== 'api')
      .map((word) => (word.endsWith('s') ? word.slice(0, -1) : word)),
  );
}

/** Every action literal the officer portal passes to `stepUp(...)`. */
function portalAsksFor(): { action: string; where: string }[] {
  const SCREENS = '../portal/src/screens';
  const asked: { action: string; where: string }[] = [];
  for (const file of readdirSync(SCREENS).filter((n) => n.endsWith('.tsx'))) {
    readFileSync(join(SCREENS, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const call = line.match(/\bstepUp\(([^)]*)\)/);
        if (!call) return;
        /*
         * A ternary passes two literals in one call -- `MyAccess` picks
         * between blocking and unblocking a machine that way -- so every
         * quoted string in the argument list counts, not just the first.
         *
         * Which is why the shape is checked. That same ternary tests
         * `device.status === 'BLOCKED'`, and the first draft of this reported
         * `BLOCKED` as a step-up action the server would refuse. Only a
         * lowercase dotted name is one: every entry in `STEP_UP_ACTIONS` is
         * written that way, and the mistake this exists to catch -- a name
         * that reads like an action and is not on the list -- is written that
         * way too. A shouted or undotted typo would slip past; the floor below
         * is what stops the rule quietly matching nothing at all.
         */
        for (const literal of call[1]!.matchAll(/'([^']+)'/g)) {
          if (!/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(literal[1]!)) continue;
          asked.push({ action: literal[1]!, where: `${file}:${index + 1}` });
        }
      });
  }
  return asked;
}

describe('a step-up code names the door it opens', () => {
  it('shares a word with every route it guards', () => {
    const sites = stepUpSites();

    /*
     * A floor, because a scan that stops matching passes this test in silence
     * — the failure mode of every guard in this repository that reads source
     * text. Twenty-one sites today; a floor rather than the exact count so
     * that adding a step-up route is not a test failure.
     */
    assert.ok(
      sites.length >= 21,
      `only ${sites.length} step-up sites found; has the scan stopped matching?`,
    );

    const wrong: string[] = [];
    for (const site of sites) {
      const named = words(site.action);
      // The route file's own name counts: `agents.ts` is mounted at `/agents`,
      // so `agent.suspend` on `POST /:id/suspend` names its subject through
      // the mount point rather than through the path literal.
      const guarded = words(`${site.path} ${site.where.split(':')[0]}`);
      if (![...named].some((word) => guarded.has(word))) {
        wrong.push(
          `${site.where}: ${site.method} ${site.path} is guarded by "${site.action}", ` +
            'which names nothing on that route',
        );
      }
    }

    assert.deepEqual(
      wrong,
      [],
      'a step-up grant for these is audited, and refused, under a name that is ' +
        'not what the officer is doing:\n  ' + wrong.join('\n  '),
    );
  });

  it('is consumed somewhere, for every action the list offers', () => {
    const consumed = new Set(stepUpSites().map((site) => site.action));
    const dead = STEP_UP_ACTIONS.filter((action) => !consumed.has(action));

    assert.deepEqual(
      dead,
      [],
      'these can be granted — `POST /auth/step-up` accepts them, and the grant ' +
        'is audited — and no route ever spends one:\n  ' + dead.join('\n  '),
    );
  });

  it('is one the list offers, for every action a route demands', () => {
    // TypeScript already refuses a `requireStepUp('typo')`, because
    // `StepUpAction` is derived from the list. This holds the same property
    // against the text, which is what the scan above actually reads: a route
    // demanding an action nobody can be granted is a permanently closed door.
    const offered = new Set<string>(STEP_UP_ACTIONS);
    const unobtainable = stepUpSites()
      .filter((site) => !offered.has(site.action))
      .map((site) => `${site.where}: ${site.action}`);

    assert.deepEqual(
      unobtainable,
      [],
      'these routes demand a grant that `POST /auth/step-up` will not issue, so ' +
        'nobody can ever pass them:\n  ' + unobtainable.join('\n  '),
    );
  });

  it('is one the list offers, for every code the officer portal asks for', () => {
    /*
     * The client half, and the half that was actually wrong.
     *
     * `stepUp` in the portal takes a plain `string`, not `StepUpAction`, so
     * nothing stopped `RoleHome` asking for `commission.payout.approve` -- a
     * name that reads perfectly and is not on the list. `POST /auth/step-up`
     * validates with `z.enum(STEP_UP_ACTIONS)` and answers 422, but only
     * *after* `/auth/otp/request` has already sent the officer a text. So the
     * payout approval on the officer's home screen sent an SMS, took the code,
     * and refused it, every time, and no test in either workspace could see it:
     * the API tests post their own valid bodies and the portal tests mock the
     * network away.
     *
     * Checked here rather than in the portal's own suite because this is a
     * fact about two workspaces at once, and this is the file that already
     * holds the list.
     */
    const offered = new Set<string>(STEP_UP_ACTIONS);
    const asked = portalAsksFor();

    assert.ok(
      asked.length >= 15,
      `only ${asked.length} portal step-up calls found; has the scan stopped matching?`,
    );

    const refused = asked
      .filter((ask) => !offered.has(ask.action))
      .map((ask) => `${ask.where}: ${ask.action}`);

    assert.deepEqual(
      refused,
      [],
      'the portal asks for these, and `POST /auth/step-up` answers 422 — after ' +
        'the officer has already been sent a code:\n  ' + refused.join('\n  '),
    );
  });
});
