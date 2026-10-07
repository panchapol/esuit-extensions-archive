# Sponsored post hiding

## ADDED Requirements

### Requirement: Recognize sponsorship data
The extension SHALL use explicit feed-unit sponsored_data.ad_id when supported Facebook internals are available, preserving the site's original execution and keeping all processing local.

#### Scenario: Sponsorship before a visible label
- **WHEN** a supported feed unit has a sponsorship ad ID before its DOM label arrives
- **THEN** its rendered content is concealed before painting

#### Scenario: Ordinary data without timestamp
- **WHEN** sponsorship data is explicitly null
- **THEN** the ordinary feed unit remains visible even if its timestamp is unreadable

#### Scenario: Unsupported internals or layout
- **WHEN** neither internal sponsorship data nor readable metadata is available
- **THEN** the DOM fallback releases the unchecked post after at most 1500 ms without new content changes, and continues observing it for ad labels

### Requirement: Recognize sponsored metadata
The extension SHALL hide supported feed post containers whose visible header metadata or accessible label reference exactly matches Sponsored, Ad, ผู้สนับสนุน, ได้รับการสนับสนุน, or โฆษณา.

#### Scenario: English and Thai labels
- **WHEN** a feed post has a supported sponsored metadata label
- **THEN** the post is hidden while enabled

#### Scenario: Split or reordered characters
- **WHEN** the supported label is split across visible inline elements or reordered with CSS
- **THEN** detection uses visible character geometry to reconstruct the label

#### Scenario: Ordinary content
- **WHEN** Sponsored occurs in post text, comments, an author heading, a hidden label, or a nested shared post
- **THEN** that occurrence does not classify the surrounding post as sponsored, and ordinary posts with supported timestamp metadata remain visible

### Requirement: Follow dynamic rendering
The extension SHALL reclassify inserted or changed feed posts and restore recycled containers that no longer contain sponsored metadata.

#### Scenario: Infinite scrolling or recycling
- **WHEN** Facebook adds a sponsored post or changes an existing container from sponsored to ordinary
- **THEN** the affected container is hidden or restored accordingly

#### Scenario: External label portal
- **WHEN** Facebook inserts a label ID deep inside a separate portal subtree, or changes text inside nested descendants of that referenced label
- **THEN** affected posts are reclassified before the next paint without relying on another post mutation

#### Scenario: Off-screen waiting expired
- **WHEN** a material post with unresolved metadata enters the viewport after its initial bounded wait expired off-screen
- **THEN** it receives a fresh bounded check before rendering, and remains observed for arriving labels

### Requirement: Collapse confirmed ad slots
The extension SHALL collapse the single-unit outer wrapper of a confirmed ad and preserve the site's original inline styles and DOM nodes.

#### Scenario: Reserved height
- **WHEN** a confirmed ad sits inside a single-child wrapper with reserved height or margins
- **THEN** that slot contributes zero layout height while hiding is enabled, without concealing sibling posts

#### Scenario: Virtualized known ad
- **WHEN** Facebook replaces a previously confirmed ad with an empty data-virtualized=true placeholder
- **THEN** its slot remains collapsed until material content returns for reclassification

#### Scenario: Restore slot
- **WHEN** the user disables hiding or the slot is reused for an ordinary post
- **THEN** the slot is restored and all site-owned styles retain their current values

### Requirement: Sponsored sidebar boundary
The extension SHALL hide sponsored sidebar sections without hiding adjacent sections.

#### Scenario: Sponsored section beside contacts
- **WHEN** an exact sponsored section heading has an adjoining outbound ad link or sponsored-content menu
- **THEN** only its smallest containing sponsored section is hidden and Contacts and Birthdays remain visible

### Requirement: User controls
The extension SHALL persist its enable state locally, apply changes across open tabs, and expose current-document hidden counts and a manual rescan.

#### Scenario: Disable and restore
- **WHEN** the user disables hiding
- **THEN** all extension-hidden posts are restored without altering their original inline styles

### Requirement: Minimize visible ad flashes
The extension SHALL start at document_start and process inserted supported sponsored posts before the next animation frame after preferences have initialized.

#### Scenario: Complete ad insertion
- **WHEN** a sponsored post is inserted with a supported label already present
- **THEN** it is hidden before the next animation frame without the former 100 ms scan delay

#### Scenario: Delayed label
- **WHEN** a new post's header metadata is unresolved
- **THEN** its content is concealed while preserving layout for up to 1500 ms without new content changes, and is hidden immediately when sponsored metadata arrives

#### Scenario: Ordinary timestamp or unknown layout
- **WHEN** ordinary header timestamp metadata is available or the user disables Reduce ad flashes
- **THEN** the post is made visible

#### Scenario: Recycled ordinary container
- **WHEN** an approved ordinary post container is reused for content with unresolved metadata
- **THEN** its earlier approval is revoked and the new content is checked with a fresh bounded wait

#### Scenario: Existing installation update
- **WHEN** the popup and Facebook content script have different versions
- **THEN** the popup tells the user to refresh Facebook and exposes the installed popup version

### Requirement: Local processing
The extension SHALL operate only on the declared desktop Facebook hosts and SHALL NOT send page content to a server.
