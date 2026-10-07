# Facebook Sponsored Hider

## Why
The archive has no extension for hiding Facebook sponsored posts. Add an independent, maintainable extension without altering any preserved ESUIT distribution.

## What changes
- Add a dependency-free Manifest V3 extension for desktop www.facebook.com and web.facebook.com.
- Hide feed posts identified by English or Thai Sponsored/Ad metadata, including visible split characters and accessible label references.
- Hide the Sponsored sidebar section without hiding adjoining sections.
- Recheck new and updated posts as Facebook renders the feed.
- Add a popup with a persistent enable switch, current-tab hidden count, and rescan action.
- Keep all processing local. Do not collect content or make network requests.

## Scope
Initial support is sponsored feed posts and sponsored sidebar sections. Marketplace, Reels overlays, in-stream video ads, and unlabeled promotions are outside this initial version. Live Facebook markup must be validated separately from controlled browser fixtures.
