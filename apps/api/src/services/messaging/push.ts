/**
 * Web push as a message provider (PRD §44).
 *
 * `providerFor('PUSH')` threw, and the comment beside it was right at the time:
 * falling back to the SMS gateway would have posted a browser subscription to a
 * telephone vendor as though it were a number. There is an adapter now, so the
 * channel resolves — and the part that matters is that it reports on the same
 * three-outcome contract as SMS and email, for the same reason.
 *
 * The recipient of a PUSH delivery is a *user id*, not an endpoint. One person
 * may have a handset, a laptop and a tablet subscribed; the notification is
 * addressed to the person and this fans it out. So the outcomes are defined
 * over a set:
 *
 *   SENT         at least one device took it. Somebody with three devices and
 *                one flat battery has still been notified.
 *   REJECTED     there are devices and none accepted, or there are none at all.
 *                Retrying changes nothing until the person subscribes again.
 *   UNAVAILABLE  this server has no VAPID identity, so nothing was attempted.
 *                Not a verdict about the recipient, and it must be retried once
 *                somebody fixes the configuration rather than burned against
 *                the attempt budget.
 *
 * The last is the distinction the notification queue turns on, and the reason
 * an unconfigured server must not report a refusal: a deployment missing two
 * environment variables would otherwise mark every citizen permanently
 * unreachable by push.
 */

import { log } from '../../lib/logger';
import { PushNotConfiguredError, sendPushNotification } from '../push';
import {
  deliveryUnavailable,
  type DeliveryRequest,
  type DeliveryResult,
  type MessageProvider,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WebPushProvider implements MessageProvider {
  readonly name = 'web-push';

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    const userId = request.recipient.trim();

    /*
     * The recipient is a user id, and it has to look like one before it goes
     * near the database.
     *
     * A queued row addressed to a subscription token, a phone number or an
     * empty string is a template that was written for the wrong channel. That
     * is a permanent refusal — retrying cannot make it a user — and it must be
     * told apart from a server with no keys, which is transient and is the
     * deployment's fault rather than the citizen's. Sending it on would raise
     * a type error from Postgres, which the catch below would then have to
     * guess about.
     */
    if (!UUID.test(userId)) {
      return {
        outcome: 'REJECTED',
        reason:
          'A push notification is addressed to a user id, and this one is not one: ' +
          `"${userId.slice(0, 40)}". The template is queuing PUSH for a recipient that is not ` +
          'a person on this platform.',
        provider: this.name,
      };
    }

    let result: { sent: number; failed: number };
    try {
      result = await sendPushNotification(
        { userId },
        { title: request.subject ?? 'PSIRS', body: request.message },
      );
    } catch (error) {
      /*
       * A push service's own refusals are handled and counted inside
       * `sendPushNotification`, so anything thrown here is about this server.
       * `PushNotConfiguredError` is the expected one and is transient: two
       * environment variables away from working, and it must be retried rather
       * than recorded against the citizen.
       *
       * Anything else is unexpected and is still not the recipient's doing, so
       * it is reported the same way — but it is logged as itself rather than
       * folded into the configuration message, because a database or network
       * fault dressed as "push is not configured" would send somebody to the
       * wrong place entirely.
       */
      if (!(error instanceof PushNotConfiguredError)) {
        log.error('push delivery raised an unexpected error', {
          component: 'push',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return deliveryUnavailable(
        this.name,
        error instanceof Error ? error.message : 'Web push is not available.',
      );
    }

    if (result.sent > 0) {
      return { outcome: 'SENT', reference: `push:${result.sent}`, provider: this.name };
    }

    return {
      outcome: 'REJECTED',
      reason:
        result.failed > 0
          ? `No registered device accepted the notification (${result.failed} refused).`
          : 'This person has no device registered for notifications.',
      provider: this.name,
    };
  }
}
