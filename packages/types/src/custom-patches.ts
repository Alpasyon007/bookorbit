export type SeriesGridOptions = {
  hierarchyOrder: "forward" | "reverse";
  groupOrder: "library" | "library-reversed" | "name-asc" | "name-desc";
  maxDepth: number;
  directBooksPosition: "first" | "last";
  standalonePosition: "first" | "last";
};

export type CustomPatchPreferences = {
  version: 1;
  seriesGrid: SeriesGridOptions & { enabled: boolean; standaloneLabel: string; headingIndent: number; showDividers: boolean };
  sidebar: { enabled: boolean; showGithub: boolean; showSupport: boolean; showIos: boolean; showAndroid: boolean };
  seriesRequests: { enabled: boolean; defaultFormat: "ebook" | "audiobook"; initialSelection: "eligible" | "none"; showRequestAll: boolean };
  coverSearch: { enabled: boolean; retailerSources: ("hachette-uk" | "waterstones" | "foyles")[]; metadataSourcesEnabled: boolean };
};

export type CustomPatchPolicy = {
  version: 1;
  seriesGridEnabled: boolean;
  sidebarCustomizationEnabled: boolean;
  seriesRequestsEnabled: boolean;
  extendedCoverSearchEnabled: boolean;
};

export const DEFAULT_CUSTOM_PATCH_PREFERENCES: CustomPatchPreferences = {
  version: 1,
  seriesGrid: {
    enabled: true,
    hierarchyOrder: "forward",
    groupOrder: "library",
    maxDepth: 0,
    directBooksPosition: "last",
    standalonePosition: "last",
    standaloneLabel: "",
    headingIndent: 0,
    showDividers: true,
  },
  sidebar: { enabled: true, showGithub: false, showSupport: false, showIos: false, showAndroid: false },
  seriesRequests: { enabled: true, defaultFormat: "ebook", initialSelection: "eligible", showRequestAll: true },
  coverSearch: { enabled: true, retailerSources: ["hachette-uk", "waterstones", "foyles"], metadataSourcesEnabled: true },
};

export const DEFAULT_CUSTOM_PATCH_POLICY: CustomPatchPolicy = {
  version: 1,
  seriesGridEnabled: true,
  sidebarCustomizationEnabled: true,
  seriesRequestsEnabled: true,
  extendedCoverSearchEnabled: true,
};
