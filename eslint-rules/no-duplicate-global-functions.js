'use strict';
// Flags a top-level `function foo(){}` declaration whose name has already
// been declared as a top-level function in a DIFFERENT file earlier in this
// same lint run. This project loads every file as a global <script> (no
// modules), so two files declaring the same top-level function name is a
// silent last-one-wins collision, not a scoping error — exactly the
// duplicate-definition bugs the Phase 0 audit flagged. Relies on ESLint's
// default single-process `eslint .` run; state is intentionally shared
// across files via module-level scope, not per-file.

const seen = new Map(); // functionName -> first filename that declared it

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow a top-level function name already declared as a top-level function in another file (global-script duplicate-definition hazard)',
    },
    schema: [],
    messages: {
      duplicate:
        "'{{name}}' is already declared as a top-level function in {{otherFile}}. Since every file shares one global scope, this silently overwrites it (or vice versa, depending on script load order).",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    return {
      'Program > FunctionDeclaration'(node) {
        if (!node.id) return; // anonymous — not reachable at top level anyway
        const name = node.id.name;
        const existing = seen.get(name);
        if (existing && existing !== filename) {
          context.report({ node: node.id, messageId: 'duplicate', data: { name, otherFile: existing } });
        } else if (!existing) {
          seen.set(name, filename);
        }
      },
    };
  },
};
