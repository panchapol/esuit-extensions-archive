# Content filtering

## Requirements

- Every topic, supported format, and supported source has an independent hide switch, off by default.
- Any enabled matching filter hides the post and collapses its reserved slot; disabling filters restores it without altering Facebook-owned styles.
- Content filters work when ad hiding is disabled. Settings persist and propagate to open Facebook tabs.
- Comments and invisible text do not classify a post. Short English keywords match word boundaries.
- Recycled posts are classified afresh. Placeholder slots stay collapsed only for still-enabled previous matches.
- Settings distinguish ads from content counts and explain approximate text-based topic matching.
- Processing stays local with the existing storage-only permission.
