/**
 * A field agent's first screen in the officer portal.
 *
 * Agents used to be refused at the door: the sign-in succeeded, the session
 * was ended again, and they were told their account belonged to the agent
 * app. The reason was honest — the menu they would have got held the revenue
 * catalogue and the presumptive schedules and nothing else, and a shell with
 * two reference tables in it reads as broken software rather than as the
 * wrong door.
 *
 * Refusing them was never a security measure, and the comment that introduced
 * it said so: every screen here is gated on a permission the API checks again
 * whichever application asks. So the answer to an empty menu is a menu. This
 * screen is what makes the other two items make sense — it says what this
 * portal is, what of it belongs to an agent's work, and where the tools that
 * do their job actually are.
 *
 * It fetches nothing and grants nothing. That is deliberate: an agent's
 * taxpayers, assessments, collections and commission are in the agent PWA,
 * which works offline at a stall where this portal would not load at all.
 * Rebuilding any of that here would be a second, worse copy of an application
 * that already exists.
 */

import { Alert } from '../ui';
import { agentAppUrl } from '../ui';
import { usePortalI18n } from '../lib/i18n';

export function FieldWorkScreen() {
  const { t } = usePortalI18n();
  const agentApp = agentAppUrl();

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t.ofcFieldWorkTitle}</h2>
      <p>{t.ofcFieldWorkBody}</p>

      <Alert kind="info" title="ofcFieldWorkToolsHeading">
        <p style={{ margin: '4px 0 0' }}>{t.ofcFieldWorkToolsBody}</p>
        {/*
          * The link, where this build knows where to point.
          *
          * `agentAppUrl()` answers from `VITE_AGENT_APP_URL` when the image
          * was built with one, and otherwise from the base path — which is
          * `/` only in the combined image. A portal on its own hostname with
          * nothing configured genuinely cannot know, and a link to `/` there
          * would be a link back to this same page. Saying who does know is
          * better than sending an agent in a circle.
          */}
        {agentApp ? (
          <p style={{ margin: '10px 0 0' }}>
            <a href={agentApp}>{t.ofcLoginOpenAgentApp}</a>
          </p>
        ) : (
          <p style={{ margin: '10px 0 0' }}>{t.ofcFieldWorkNoLink}</p>
        )}
      </Alert>

      <h3>{t.ofcFieldWorkHereHeading}</h3>
      <p style={{ margin: 0 }}>{t.ofcFieldWorkHereBody}</p>
    </div>
  );
}
