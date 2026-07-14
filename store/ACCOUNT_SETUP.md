# Chrome Web Store Developer Account

These are account-owner actions. They cannot be completed by the extension build or by an automated coding agent.

## Before registration

- Use a dedicated Google account for publishing if practical.
- Choose the account carefully: the Chrome Web Store developer email cannot be changed after registration without creating another account and transferring items.
- Use an inbox that WSL043 checks regularly for policy, review, and security notices.
- Enable Google two-step verification before attempting to publish or update an item.

## Register and configure

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Review and accept the developer agreement and policies.
3. Pay the one-time developer registration fee.
4. Verify the developer contact email in the dashboard.
5. Set the public publisher display name and support contact deliberately.
6. Add a physical address only if LoudEase later sells purchases, features, or subscriptions and the dashboard requires it.
7. Do not configure the Chrome Web Store API for the first release. Manual first publication is simpler and keeps credentials out of the project.

Official references:

- [Register a Chrome Web Store developer account](https://developer.chrome.com/docs/webstore/register)
- [Set up the developer account](https://developer.chrome.com/docs/webstore/set-up-account)
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Configure distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Chrome Web Store programme policies](https://developer.chrome.com/docs/webstore/program-policies/policies)

## Repository boundary

Never commit publisher credentials, backup codes, payment details, OAuth secrets, API tokens, or dashboard exports. The project needs only public listing copy, privacy disclosures, screenshots, package files, and non-secret test instructions.
