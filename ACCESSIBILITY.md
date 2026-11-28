# Accessibility

## Scope

PromptAudit Shield is a local JavaScript/TypeScript masking library, not a graphical application. Its accessibility depends in part on the application, editor, terminal and documentation viewer used with it. This statement covers this repository and its documentation, not the separate PromptAudit platform or Capture Agent.

## Using the project

- The README provides text-based installation instructions and code examples. The decorative banner is not required to follow them.
- Library inputs and outputs are programmatic text or structured values. An integrating application is responsible for accessible controls, labels, status announcements and presentation of results.
- Setup questions can be raised in [Discussions](https://github.com/PromptAudit-SaaS/shield/discussions); reproducible barriers can be reported in [Issues](https://github.com/PromptAudit-SaaS/shield/issues).

## Known limitations and validation status

No independent accessibility audit or WCAG conformance assessment has been completed. Screen-reader, Braille-display, speech-input and other assistive-technology compatibility has not been verified. Keyboard navigation, contrast, zoom and small-screen presentation of GitHub pages are partly controlled by GitHub and the user's browser; the library cannot guarantee them. A documentation rendering check does not establish assistive-technology compatibility.

## Reporting a barrier

Describe the affected page or example, package version, operating system, browser/editor or runtime, assistive technology and version if applicable, expected behaviour and observed behaviour. Use fictional inputs and redact personal data, credentials and original masking values. Do not post secrets, restoration maps or sensitive screenshots.

If the issue form itself is a barrier, use a plain issue or a Discussion where available. Security-sensitive reports must follow [SECURITY.md](SECURITY.md), not a public accessibility report. We review reported barriers and document confirmed limitations; community support has no guaranteed response time or remediation deadline.