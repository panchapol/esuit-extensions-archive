# Facebook Sponsored Hider

An independent Chrome extension that hides sponsored Facebook feed posts and the Sponsored sidebar section, with optional topic, format, and source filters. This is new development, separate from the archived ESUIT extensions.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this project's `extension` folder:
   `/Users/panchapol/code/esuit-extensions-archive/facebook-sponsored-hider/extension`
5. Refresh your open Facebook tabs. Pin the extension from Chrome's Extensions menu if you want easy access to its popup.

Alternatively, extract `artifacts/facebook-sponsored-hider-0.2.0.zip` into a folder, then select that extracted folder with **Load unpacked**. Chrome does not load the ZIP directly.

To apply a local update, click the extension's **Reload** button in `chrome://extensions`, then refresh Facebook. If you installed from an extracted ZIP, replace its files with the new ZIP contents before reloading.

Confirm that the popup footer says **v0.2.0** and **Reduce ad flashes** is enabled. The popup warns when the current Facebook tab still runs an older content script and needs a refresh.

No npm install or build step is needed to use the extension. See Chrome's [official unpacked-extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Content settings

Open the extension popup or right-click its icon and select **Options**. Turn on a switch to hide that content; turn it off to restore matching posts. Each filter works independently and all new filters default off. Existing ad preferences are preserved.

| Group | Independent switches |
| --- | --- |
| Topics | Sports; AI & programming; Blockchain & crypto; News & public affairs; Entertainment & music |
| Formats | Videos; Photos; Text-only posts; Reels |
| Sources | Group posts; Suggested for you |

A post is hidden when it matches any enabled switch. Reels also match Videos. Photos require a visible, substantial image, excluding avatars and video thumbnails; text-only posts have a message without detected photo/video media. Source filters use header group links or an explicit English/Thai suggested label. They do not distinguish all followed pages from friends.

Topic matching uses local English/Thai keyword rules over rendered author/message text, excluding comments and hidden text. It is approximate and can miss unfamiliar wording or topics shown only in images/video, and can match a topic mentioned incidentally. No AI service is called. Hidden content uses the same slot collapse as ads. Filters work with **Hide Facebook ads** turned off, persist on this device, and update open Facebook tabs. Ad blocks and content posts have separate current-tab counts.

## Features

- Hides feed posts with English **Sponsored** / **Ad** or Thai **ผู้สนับสนุน**, **ได้รับการสนับสนุน**, or **โฆษณา** metadata.
- Handles plain labels, accessible labels and `aria-labelledby` references, split letters, and CSS-reordered characters.
- Supports article/FeedUnit containers and the `data-virtualized` wrappers observed on Facebook on 7 October 2026.
- Hides the Sponsored sidebar section while retaining neighboring sections such as Birthdays and Contacts.
- Watches new and updated posts as you scroll. Reclassifies recycled post containers and renews checks for unresolved material posts entering view after their off-screen waiting period expired. Follows IDs inserted deep inside external label portals and changes to nested referenced text.
- Collapses the outer single-unit ad slot, including reserved height and margins. Remembers confirmed ads when Facebook virtualizes them into empty placeholders, so their reserved space does not reappear. Disabling restores slots and current site-owned inline styles.
- Starts at `document_start` and processes mutations in a microtask before the next render, removing the former 100 ms scan delay.
- When supported Facebook internals are available, reads the current CometRelay environment or the observed publish queue and checks the feed unit's `sponsored_data.ad_id` during rendering. Ads with this data are concealed before their DOM label arrives; explicit null sponsorship releases ordinary posts without needing to recognize a timestamp. This signal was identified by inspecting the user-supplied ESUIT Ad Blocker v2.10.0; the hook is independently implemented without its vendors, subscriptions, or source rewriting.
- A startup stylesheet conceals unchecked containers before JavaScript classifies them. **Reduce ad flashes** is enabled by default. Recognizable ordinary timestamps release posts immediately; unknown layouts appear automatically after a bounded 1.5-second wait without content changes. This fixes the 0.1.2 behavior that could leave normal posts blank indefinitely and show only Reels. Recycled containers receive a fresh check when their content changes.
- Turn off **Reduce ad flashes** to show unchecked posts immediately while continuing to hide detected ads. Reels and Stories carousels remain visible unless a matching content filter is enabled.
- Offers persistent ad/content switches, current-tab counts, and manual rescan. Disabling ad hiding restores ads across all open Facebook tabs; independent content filters still apply.

The popup count is currently connected hidden **feed posts plus sponsored sidebar sections**. A sidebar section containing two ads counts as one block. The count can decrease when Facebook removes virtualized posts; it is not a lifetime total.

Posts waiting for metadata are reported separately and do not count as detected ads.

## Scope and privacy

Runs on desktop `https://www.facebook.com/*` and `https://web.facebook.com/*`. The only extension API permission is `storage`, which saves your ad, label-waiting, and content-filter preferences on this device. The manifest also declares content-script access to those two Facebook hosts.

Detection happens locally. An isolated script handles DOM labels and preferences; a small MAIN-world script observes two Facebook module exports to read sponsorship from the existing Relay store. It preserves original component calls, React hooks, module results, and queue execution, and puts only ad/ordinary state into the DOM. It does not rewrite Facebook source or responses. The extension makes no network requests, sends no post content, and includes no analytics or ESUIT subscription integration. It changes page visibility; Facebook can still fetch ads in the background.

This version does not target in-stream video ads, Reels overlays, Marketplace ads, or unlabeled promotions. Detection intentionally checks metadata near the top of posts rather than searching all post text. Facebook markup changes, additional languages, and unsupported obfuscation may require detector updates.

## Validation

The extension was loaded into an isolated Chromium profile and tested against controlled Facebook-host fixtures. Nineteen browser scenarios passed (twenty Node test results including the parent test): startup rendering, supported labels, false-positive protection, sidebar boundaries, deep external label portals, outer-slot collapse through virtualization and disabling/recycling, viewport entry after an expired off-screen wait, automatic recovery for unreadable ordinary metadata, direct, linked Relay, and current-context sponsorship before paint, preservation of original module/queue results and component errors, synchronous CSS concealment, late labels with recycled containers, waiting and opt-out, insertion/recycling, settings across tabs/reloads, popup/version controls, independent English/Thai topic filters and false-positive boundaries, format/source filters and late image loading, content settings across tabs/reloads with ad hiding off, overlap and recycled-slot restoration, and count/observer stability. Internal-module fixtures simulate the contracts observed in the supplied code; they do not prove compatibility with every live Facebook build.

The signed-in live Facebook page was inspected read-only to confirm `data-virtualized` wrappers, referenced **Ad** labels, and sidebar structure. On 7 October 2026, the signed-in tab was verified running 0.1.3. Its early data hook produced no unit annotations, and scrolling showed off-screen placeholders retaining their old min-height. Two new regressions failed on 0.1.3: nested portal label detection and outer-slot collapse. Both pass on 0.1.4, along with a viewport-entry regression. A subsequent read-only check confirmed the signed-in tab running v0.1.4 with the current Relay-context hook and an ad slot collapsed to zero height. This was a limited live sample; the new v0.2.0 content switches have been tested on controlled fixtures and need a reload before live use. Facebook-private modules can change; unsupported internals fall back to DOM detection. If both internal data and readable labels are unavailable for more than 1.5 seconds, an ad may briefly appear before a later label hides it. Disabling flash reduction also permits late-labeled flashes.

## Development

```sh
cd facebook-sponsored-hider
npm ci
npx playwright install chromium
npm test
npm run package
```

Runtime files are dependency-free. Playwright is used only for development tests. Test pages are fulfilled locally by the test runner; tests do not log into Facebook or use personal browser profiles.

## Files

| Path | Purpose |
| --- | --- |
| `extension/manifest.json` | Manifest V3 registration, Facebook hosts, storage permission, popup |
| `extension/page-data.js` | Optional MAIN-world feed sponsorship classification before rendering labels |
| `extension/detector.js` | Post boundaries, header-label detection, sponsored sidebar detection |
| `extension/filters.js` | Shared filter settings and local topic/format/source classification |
| `extension/content.js` | Batched mutation handling, hide/restore behavior, settings and messaging |
| `extension/content.css` | Hides elements tagged by this extension |
| `extension/popup.*` | Grouped hide switches, separate ad/content counts, rescan, Options page |
| `tests/` | Local fixtures and installed-extension browser tests |
| `scripts/package.py` | Creates a runtime-only ZIP in `artifacts/` |

Chrome references: [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage).
