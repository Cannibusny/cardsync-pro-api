const { getSupabase } = require('../supabase');

// Fire-and-forget activity logger. Never blocks the request — failures are
// console.warned and swallowed.
async function logActivity({ user, action, resourceType, resourceId, details, req }) {
  try {
    const supabase = getSupabase();
    await supabase.from('activity_logs').insert({
      user_id:       user ? user.id : null,
      user_email:    user ? user.email : null,
      action,
      resource_type: resourceType || null,
      resource_id:   resourceId || null,
      details:       details ? details : null,
      ip_address:    req ? (req.headers['x-forwarded-for'] || req.ip || null) : null,
      user_agent:    req ? (req.headers['user-agent'] || null) : null,
    });
  } catch (err) {
    console.warn('[activity-log] failed to persist:', err.message || err);
  }
}

module.exports = { logActivity };
