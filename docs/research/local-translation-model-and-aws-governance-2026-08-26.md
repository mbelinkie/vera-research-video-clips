# Local translation model and AWS governance research

Date checked: 2026-08-26

## Purpose

Record the external evidence behind the proposed local-first translation and
admin-governed Amazon Translate program. This is a research snapshot, not an
approved VERA model registry and not implementation evidence.

## Argos runtime and package format

- [Argos Translate](https://github.com/argosopentech/argos-translate) is an
  offline Python translation library licensed under MIT or CC0.
- Its package implementation describes `.argosmodel` files as ZIP archives
  containing metadata, a CTranslate2 model, and SentencePiece or BPE tokenizer
  data. The upstream library can install and uninstall packages, but VERA must
  not consume the mutable package index directly at runtime.
- [CTranslate2 installation documentation](https://opennmt.net/CTranslate2/installation.html)
  lists prebuilt Python support for macOS x86-64 and ARM64, Windows x86-64, and
  Linux x86-64/AArch64. Its
  [hardware documentation](https://opennmt.net/CTranslate2/hardware_support.html)
  states that prebuilt x86-64 CPU binaries require at least SSE 4.1.
- The production design should therefore package a pinned, platform-specific,
  CPU-first Argos/CTranslate2 sidecar. The sidecar should receive bounded JSON
  through an app-owned process boundary and have no network authority; the
  Electron main/local-agent boundary should own model acquisition, integrity,
  storage, leases, and deletion.

## Current upstream language availability

The raw [Argos package index](https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json)
contained 49 languages with both an English-to-language and language-to-English
entry when checked. Codes and upstream display names were:

```text
ar Arabic               az Azerbaijani          bg Bulgarian
bn Bengali              ca Catalan              cs Czech
da Danish               de German               el Greek
eo Esperanto            es Spanish              et Estonian
eu Basque               fa Persian              fi Finnish
fr French               ga Irish                gl Galician
he Hebrew               hi Hindi                hu Hungarian
id Indonesian           it Italian              ja Japanese
ko Korean               ky Kyrgyz               lt Lithuanian
lv Latvian              ms Malay                nb Norwegian
nl Dutch                pb Portuguese (Brazil)  pl Polish
pt Portuguese           ro Romanian             ru Russian
sk Slovak               sl Slovenian            sq Albanian
sv Swedish              sw Swahili              th Thai
tl Tagalog              tr Turkish              uk Ukrainian
ur Urdu                 vi Vietnamese           zh Chinese
zt Chinese (traditional)
```

The upstream index misspells the `uk` display name as “Ukranian”; VERA should
use its own normalized BCP-47 display labels. The index includes many large
language communities—Arabic, Bengali, Chinese, French, German, Hindi,
Indonesian, Italian, Japanese, Korean, Persian, Portuguese, Russian, Spanish,
Swahili, Thai, Turkish, Ukrainian, Urdu, and Vietnamese—but has no current pack
for several other major languages, including Gujarati, Kannada, Malayalam,
Marathi, Punjabi, Tamil, and Telugu.

This count is upstream availability only. It does not establish redistribution
rights, model quality, VERA compatibility, or approval.

## Licensing and approval boundary

- The [Argos package-index repository](https://github.com/argosopentech/argospm-index)
  is MIT/CC0, but that repository license does not prove the license of every
  trained model and every training-data dependency.
- Upstream issue
  [#507](https://github.com/argosopentech/argos-translate/issues/507) documents
  packs whose embedded README has no explicit license and identifies a separate
  set that declares CC BY 4.0.
- Upstream issue
  [#533](https://github.com/argosopentech/argos-translate/issues/533) asks for
  explicit clarification of commercial use and redistribution rights for the
  trained language packs and remained open when checked.
- An upstream package link, index entry, or successful download is therefore
  insufficient for VERA approval. Each direction must pass the same audit for
  exact immutable bytes, model and training-data license compatibility,
  provenance, attribution/notice obligations, runtime compatibility, and the
  release's functional/quality gate.
- VERA should ship a release-owned approved registry and expose it as the
  authoritative “VERA approved” list. It may expand incrementally as more packs
  pass, but it must never silently convert “available upstream” into “approved.”

## Quality boundary

The upstream index does not provide one comparable quality score across every
pair. VERA must apply the same validation procedure and fixtures to every
candidate direction, record the validation revision, and avoid promising equal
translation quality across languages. A pack that is legally clear and
operationally valid can still fail VERA's release gate.

The approved registry should distinguish:

- `available_upstream`: discovered in the pinned research snapshot only;
- `approved`: passed the release-owned legal, provenance, integrity, runtime,
  and validation gates;
- `installed`: verified bytes currently present on this workstation.

## Amazon Translate cost and metering

- [Amazon Translate pricing](https://aws.amazon.com/translate/pricing/) charges
  standard text translation by characters processed, including whitespace.
  The public price was USD 15 per million characters when checked, with an AWS
  free-tier offer subject to account age and AWS terms.
- The application must not assume that price or free-tier availability is
  permanent. Store an operator-configured price-per-million, currency, and
  effective date and label all displayed dollar amounts as estimates.
- Amazon Translate publishes a CloudWatch
  [`CharacterCount` metric](https://docs.aws.amazon.com/translate/latest/dg/translate-cloudwatch.html)
  representing billable characters. VERA still needs request-level application
  metering to attribute usage to an approved user because the documented AWS
  dimensions are operation and language pair, not VERA user ID. Reconcile the
  aggregate application count against CloudWatch rather than placing user data
  in AWS metric dimensions.

## Identity authority

Amazon Cognito user-pool groups place group membership in token claims as
described in the
[Cognito group documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-user-groups.html).
The proposed `vera-platform-admins` group is a platform-spend authority, not a
project role. The cloud API must derive the capability from a verified token
claim and expose a bounded application capability; neither React nor a database
profile field may self-assign it.

## Research conclusion

Argos/CTranslate2 is a technically plausible no-per-call-cost local route on
the target desktop platforms, and the English-hub index covers 49 bidirectional
languages. The blocking release question is pack-by-pack approval, not raw
availability. Build the lifecycle and provider integration against a
release-owned audited registry, launch with every pack that passes the same
rules, and add later packs without language-specific favoritism.
