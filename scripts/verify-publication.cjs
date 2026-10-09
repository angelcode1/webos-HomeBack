#!/usr/bin/env node
/**
 * Public-release publication gate.
 *
 * HomeBack derives from GPL-2.0-only AltHome, whereas the separately
 * source-built native inputhookpp component is GPL-3.0. A release must
 * comply with both licenses and carry source/build provenance.
 *
 * This is a maintainer acknowledgement, not automatic license clearance.
 */
const confirmed = process.env.HOMEBACK_NATIVE_REDISTRIBUTION_CONFIRMED === '1';
if (!confirmed) {
  console.error(
    'Public release blocked: native redistribution and GPL-2.0-only/GPL-3.0 compatibility ' +
    'have not been acknowledged by the maintainer for this source-built release.\n\n' +
    'Review THIRD_PARTY_NOTICES.md, native/README.md, the pinned source and patches, ' +
    'and the exact IPK contents. Confirm source availability and license obligations.\n\n' +
    'Set HOMEBACK_NATIVE_REDISTRIBUTION_CONFIRMED=1 only after that review.\n' +
    'This acknowledgement is not itself a legal determination.'
  );
  process.exit(1);
}
console.log('Maintainer acknowledged native provenance and distribution review for this release.');
