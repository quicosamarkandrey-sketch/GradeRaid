'use strict';
// Phase 2 (Security Hardening) fix.
//
// This used to be expressed as a `no-restricted-syntax` selector
// (`AssignmentExpression[left.property.name='innerHTML']`) declared in the
// Phase 0 config. It never actually ran: a later config block in
// eslint.config.js also matches every `**/*.js` file and also sets
// `no-restricted-syntax` (for the DB.* mutation check). In ESLint's flat
// config, when two config objects match the same file and set the same rule
// key, the later object's value REPLACES the earlier one entirely — arrays
// of selectors are not merged. So the DB.* selector silently ate the
// innerHTML selector, and this codebase has had zero lint enforcement on raw
// `.innerHTML =` assignments since Phase 0 landed (334 occurrences exist;
// none were ever flagged). This is exactly the "no shared, enforced
// rendering path" gap Phase 2 targets, and almost certainly how the
// `world-boss/leaderboard.js` / `leaderboard/hall-of-fame.js` unescaped-name
// bugs shipped without the safety net catching them.
//
// Pulling this out into its own plugin rule (rather than another
// `no-restricted-syntax` entry) makes it immune to this specific collision
// going forward, since each plugin rule gets its own config key.

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow raw `.innerHTML =` assignment; route through the shared _esc() escape helper (utils.js)',
    },
    schema: [],
    messages: {
      raw:
        'Raw `.innerHTML =` assignment. Route this through the shared _esc() escape helper (utils.js) instead of interpolating strings directly — unescaped innerHTML is an XSS hazard for anything derived from student/user input.',
    },
  },
  create(context) {
    return {
      'AssignmentExpression[left.type="MemberExpression"][left.property.name="innerHTML"]'(node) {
        context.report({ node, messageId: 'raw' });
      },
    };
  },
};
