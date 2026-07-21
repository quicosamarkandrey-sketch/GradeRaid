'use strict';
// Phase 2 (Security Hardening) follow-up to the `world-boss/leaderboard.js` /
// `leaderboard/hall-of-fame.js` unescaped-name findings.
//
// This codebase has no shared "safe render" entry point — every module
// builds `innerHTML` strings by hand with template literals, and whether a
// given interpolated field gets run through `_esc()` is a per-author,
// per-line decision. 689 call sites got it right; 2 files (10 call sites)
// didn't, because nothing forced it. This rule doesn't try to solve escaping
// generally (that would need real taint tracking); it flags the specific,
// recurring shape the audit actually found: a template-literal expression
// that is a bare property access (`s.name`, `p.studentName`, `entry.student.profilePic`,
// no method call, no `_esc(...)` wrapper) whose *property name* matches a
// known list of user-controlled, DB-sourced display fields.
//
// Intentionally conservative / high-signal over broad:
//  - Only bare `foo.bar` / `foo.bar.baz` member expressions trigger it, not
//    every expression in every template literal (so numeric stats, computed
//    labels, emoji, etc. are silent).
//  - Anything already wrapped in `_esc(...)` is fine.
//  - Property names are a maintained allowlist-of-danger, not a guess — add
//    to UNAMBIGUOUS_DANGER_PROPS / AMBIGUOUS_DANGER_PROPS as new
//    user-controlled text fields are introduced.
//  - `name`/`init` alone are ambiguous (bosses, items, titles, skills, quiz
//    questions all have a `.name` too) so those two additionally require the
//    object side to look like a student/user record, per this codebase's own
//    variable-naming conventions.

// Unambiguous no matter which object they hang off of — no other entity in
// this codebase (bosses, items, titles, achievements, skills, quiz
// questions, ...) has fields with these exact names.
const UNAMBIGUOUS_DANGER_PROPS = new Set(['displayName', 'studentName', 'studentInit', 'profilePic']);

// Ambiguous — plenty of non-person entities also have a `.name`/`.init`,
// e.g. `boss.name`, `item.name`, `title.name`, `skill.name`. Only flag these
// when the object side of the member expression looks like a student/user
// record, going by this codebase's own variable-naming conventions (`s`,
// `p`, `student`, `st`, `currentUser` — see wblRenderRow/_holRenderCard/etc.).
const AMBIGUOUS_DANGER_PROPS = new Set(['name', 'init']);
const STUDENT_OBJECT_PATTERN = /(^|[._])(student|currentUser|st)$|^[sp]$/i;

function isBareMemberExpression(node) {
  return node && node.type === 'MemberExpression' && !node.computed;
}

function propName(node) {
  return node.property && node.property.type === 'Identifier' ? node.property.name : null;
}

// Template literals are used for plenty of non-markup strings too (log
// messages, CSV rows, plain concatenation). Only bother checking ones that
// actually look like they're building an HTML fragment, so e.g.
// `console.log(\`[LevelUp] ${student.name} ...\`)` isn't flagged.
const HTML_SHAPE_PATTERN = /<[a-zA-Z]/;

// dom.js's toast()/showModal() both do `el.innerHTML = msg` internally, so a
// template literal handed straight to either is just as exploitable as one
// assembling markup itself — even if the literal has no `<tag>` in it (e.g.
// `toast(\`Granted "${title.name}" to ${student.name}!\`)`). Treat these call
// sites as HTML-shaped regardless of the tag-sniffing heuristic below.
const RAW_HTML_SINK_CALLEES = new Set(['toast', 'showModal']);

function isArgumentToHtmlSink(node) {
  const parent = node.parent;
  return (
    parent &&
    parent.type === 'CallExpression' &&
    parent.callee.type === 'Identifier' &&
    RAW_HTML_SINK_CALLEES.has(parent.callee.name) &&
    parent.arguments[0] === node
  );
}

function looksLikeHtml(templateLiteralNode, sourceCode) {
  return HTML_SHAPE_PATTERN.test(sourceCode.getText(templateLiteralNode)) || isArgumentToHtmlSink(templateLiteralNode);
}

function objectLooksLikeStudent(node, sourceCode) {
  const objText = sourceCode.getText(node.object);
  // Take just the last identifier segment (e.g. `entry.student` -> `student`,
  // `myEntry.student` -> `student`) so the pattern doesn't need to guess
  // every possible outer wrapper name.
  const lastSegment = objText.split('.').pop();
  return STUDENT_OBJECT_PATTERN.test(lastSegment) || STUDENT_OBJECT_PATTERN.test(objText);
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow interpolating a known user-controlled display field (name, profilePic, bio, ...) into a template literal without passing it through _esc() first',
    },
    schema: [],
    messages: {
      unescaped:
        "'{{expr}}' looks like a user-controlled display field interpolated directly into markup. Wrap it in _esc(...) (see utils.js) or confirm this string never reaches innerHTML.",
    },
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        const sourceCode = context.sourceCode || context.getSourceCode();
        if (!looksLikeHtml(node, sourceCode)) return;
        for (const expr of node.expressions) {
          if (!isBareMemberExpression(expr)) continue;
          const name = propName(expr);
          if (!name) continue;

          const isDanger =
            UNAMBIGUOUS_DANGER_PROPS.has(name) ||
            (AMBIGUOUS_DANGER_PROPS.has(name) && objectLooksLikeStudent(expr, sourceCode));
          if (!isDanger) continue;

          context.report({
            node: expr,
            messageId: 'unescaped',
            data: { expr: sourceCode.getText(expr) },
          });
        }
      },
    };
  },
};
