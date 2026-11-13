import type { ReleaseNote } from '@bookorbit/types';

export const CUSTOM_RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: 'v3.8.0-custom.2',
    name: 'Custom revision 2: release notes and automatic image updates',
    date: '2026-11-13',
    highlights: [
      {
        icon: 'Sparkles',
        title: "Our changes in What's New",
        body: 'Custom revisions now appear alongside upstream releases, with an explanation of each change. Our notes are included in the image and remain available when GitHub update checks are disabled or unavailable.',
        media: [],
      },
      {
        icon: 'Bell',
        title: 'Notifications for custom revisions',
        body: "Moving to a newer custom revision now updates the What's New indicator and optional popup. Marking the notes as read remembers the complete custom revision for your account.",
        media: [],
      },
      {
        icon: 'RefreshCw',
        title: 'Follow verified custom images',
        body: 'The latest image tag follows new custom releases after their checks pass. Deployments configured to pull and recreate from latest can follow these updates; exact version tags remain available for pinned deployments.',
        media: [],
      },
    ],
    changelogUrl: 'https://github.com/Alpasyon007/bookorbit/tree/v3.8.0-custom.2',
    changelogBody:
      "### Custom changes\n\n- Show bundled custom release notes alongside upstream notes.\n- Recognize custom revision upgrades without repeating upstream highlights.\n- Preserve each account's read state and popup preference.\n- Publish the same verified image under its version tag and latest. Older release runs cannot move latest backwards.\n\nBased on upstream v3.8.0. This revision adds no database migrations.",
  },
  {
    version: 'v3.8.0-custom.1',
    name: 'Custom revision 1: first verified custom build',
    date: '2026-11-12',
    highlights: [
      {
        icon: 'Tag',
        title: 'Clearly identified custom builds',
        body: 'The app displays its full custom version so you can distinguish this installation from the upstream release. Upstream update notifications and release highlights continue to follow the installed base version.',
        media: [],
      },
      {
        icon: 'ShieldCheck',
        title: 'Checked before publication',
        body: 'Custom images must pass application checks, API and permission tests, production builds and startup checks before they can be published.',
        media: [],
      },
    ],
    changelogUrl: 'https://github.com/Alpasyon007/bookorbit/tree/v3.8.0-custom.1',
    changelogBody:
      '### Custom changes\n\n- Display explicit custom revision labels.\n- Keep upstream update indicators and release-note filtering working with custom labels.\n- Require successful automated checks before publishing each custom image.\n\nBased on upstream v3.8.0. The custom changes add no database migrations.',
  },
];
