import { appendFileSync } from "node:fs";
import { publishImage, publicationOutputs } from "./publish-image.mjs";
import { compareUkMetadataVersions, ukMetadataImageTag, ukMetadataPackageVersion, validateUkMetadataReleaseTag } from "./uk-metadata-version.mjs";

try {
  const version = validateUkMetadataReleaseTag(process.env.TAG, ukMetadataPackageVersion());
  const result = await publishImage(
    {
      image: process.env.IMAGE,
      version,
      expectedId: process.env.EXPECTED_ID,
      username: process.env.GHCR_USER,
      token: process.env.GHCR_TOKEN,
    },
    { imageTag: ukMetadataImageTag, compareVersions: compareUkMetadataVersions },
  );
  appendFileSync(process.env.GITHUB_OUTPUT, publicationOutputs(result));
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Verified UK metadata provider image\n\nImage: \`${result.image}\`\n\nDigest: \`${result.digestRef}\`\n\nLatest: \`${result.latestDigestRef}\` (${result.latestStatus}, \`${result.latestVersion}\`)\n`,
  );
} catch {
  // Do not print lower-level registry errors containing credentials.
  console.error("UK metadata image publication or latest verification failed; no success summary was written");
  process.exitCode = 1;
}
