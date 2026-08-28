#!/usr/bin/env node

const confirmed = process.env.HOMEBACK_NATIVE_REDISTRIBUTION_CONFIRMED === '1';

if (confirmed) {
	console.log('Native payload redistribution confirmation acknowledged for this release.');
	process.exit(0);
}

console.error(`Public release blocked: the bundled ezinject/libinputhookpp.so payload came from an\nunofficial community build whose modified-source provenance and redistribution terms have not\nyet been confirmed. See THIRD_PARTY_NOTICES.md.\n\nAfter the maintainer has independently confirmed redistribution rights for these exact binaries,\nrerun the release with:\n\n  HOMEBACK_NATIVE_REDISTRIBUTION_CONFIRMED=1 ./scripts/release.sh\n\nThis guard is not a legal determination; it prevents accidental publication while provenance is open.`);
process.exit(1);
