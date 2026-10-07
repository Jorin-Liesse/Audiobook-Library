# Privacy and terms pages

The public policy URLs are:

- Privacy policy: https://jorin-liesse.github.io/Audiobook-Library/privacy
- Terms of service: https://jorin-liesse.github.io/Audiobook-Library/term

The routes live under `src/routes/(legal)/`. They are prerendered with server-side rendering enabled, producing `build/privacy/index.html` and `build/term/index.html`. GitHub Pages redirects the extensionless URLs to their trailing-slash versions. The documents are readable without JavaScript, a selected library, or Google sign-in. The library's ⋯ menu links to both pages in a new tab so playback can continue. These links are available before sign-in.

## Publish on GitHub Pages

1. In the repository's **Settings > Pages**, select **GitHub Actions** as the build and deployment source. The website must be publicly accessible for use on a Google OAuth consent screen. GitHub Pages availability for a private repository depends on the account's plan.
2. Push these changes to `main`, then run **Actions > Deploy Web > Run workflow** on `main`. The existing workflow deploys manually.
3. After the deployment succeeds, open both URLs while signed out to confirm that they are public. Check that the pages show the documents rather than the library app or a 404.
4. Add these URLs to the privacy policy and terms of service fields in **Google Auth Platform > Branding** for the Google Cloud project used by the app.

## Maintain the documents

The pages use the maintainer's GitHub profile as the contact link. Replace that link in both documents with a monitored contact email if desired. Update the policy and its date whenever the app's actual data handling changes.

The current disclosure covers local files and storage, account details returned by Drive, filenames and sizes in sync snapshots, listening state, revision timestamps, device/session identifiers, token storage, Google sign-in library loading, hosting, retention, and deletion. Disconnecting does not delete cloud snapshots or local account caches, and does not revoke Google's authorization.

References used when preparing the disclosures:

- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google Drive application data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
