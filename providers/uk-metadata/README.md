# UK metadata companion for BookOrbit

One container serves three providers through BookOrbit's external metadata provider protocol.

| Provider address                      | Metadata                          | Artwork                |
| ------------------------------------- | --------------------------------- | ---------------------- |
| `http://uk-metadata:8080/hachette-uk` | Hachette UK's public book catalog | Hachette UK jacket     |
| `http://uk-metadata:8080/waterstones` | Open Library edition data         | Waterstones jacket CDN |
| `http://uk-metadata:8080/foyles`      | Open Library edition data         | Foyles jacket CDN      |

This is an unofficial personal-use integration. The retail jacket endpoints are public and undocumented. The publisher integration reads the public search page and structured book data. See [Hachette UK's website terms](https://www.hachette.co.uk/landing-page/terms-and-conditions-all/), [Foyles' website terms](https://www.foyles.co.uk/help/website-terms-and-conditions), and [Open Library's API usage guidelines](https://openlibrary.org/developers/api) before configuring a source.

## Install

Add this service to the Compose project that runs BookOrbit. Keep the port within the Compose network.

```yaml
services:
  uk-metadata:
    image: ghcr.io/alpasyon007/bookorbit-uk-metadata:0.1.0
    restart: unless-stopped
    environment:
      OPEN_LIBRARY_CONTACT: ${OPEN_LIBRARY_CONTACT:-}
      AUTH_TOKEN: ${UK_METADATA_AUTH_TOKEN:-}
```

Set `OPEN_LIBRARY_CONTACT` to an email address you control if you use the Open Library-backed sources regularly. If you set `UK_METADATA_AUTH_TOKEN`, the companion expects `Authorization: Bearer <token>` for provider requests. `/health` returns `{"status":"ok"}` without authentication. The container listens on port 8080 by default.

In BookOrbit, go to **Settings → Metadata → Providers → External**. Use **Add provider** for each address you want. For this private Compose network, enable **Allow private address**. If you configured a token, enter `Bearer <token>` as the provider's **Authorization header**. Save, test and enable each provider. You can then choose it in manual metadata search and as a compatible cover source. Enable it in individual metadata field rules if you want those fields to use it.

For a separate NAS app, use the same image and container port `8080`. The companion needs no database or volumes. If BookOrbit cannot reach the companion by container name, publish the port on the NAS's LAN interface and replace `uk-metadata:8080` in the three addresses with the NAS hostname or IP and published port, such as `nas.local:18080`. Use **Allow private address** for LAN addresses. The provider can stay private to your network. The image is also available as `latest`, while `0.1.0` pins this release.

In the provider test, try `The Fifth Season` for Hachette UK and `The Poppy War` for the retailer jackets. A successful connection can return no results for the default test title. Test with a known title before choosing your field rules.

## Coverage and data sent

- The companion searches book editions by title and optional author. Search by ISBN or lookup by provider ID targets one exact edition. Provider IDs are normalized ISBN-13s and stay distinct by source. The provider advertises portrait book covers for text books.
- Hachette UK receives the title or exact ISBN. The companion checks the author against the publisher's result locally and returns metadata and artwork from the matching publisher edition.
- Waterstones and Foyles receive only ISBNs in jacket requests. Open Library supplies the title, author and edition discovery. The companion checks a bounded selection of editions and returns only editions with a verified jacket from the named retailer. Open Library artwork is never substituted. Different editions and the two retailers can share identical jacket art.
- Title search favors matching English editions and UK publication details when present. Jacket availability varies by ISBN and catalog coverage. Provide an exact print ISBN if a title search does not find the edition you want. Missing or placeholder jackets are omitted. When a source withdraws access or changes its page or CDN format, results can become unavailable.
- The companion limits and caches requests in memory, sends an identifying user agent, and never logs searches, ISBNs, or authorization. Source throttling is reported as HTTP 429, temporary source failures as 502, and incomplete results as partial so BookOrbit can handle them accordingly. Use these sources for targeted discovery; Open Library provides data dumps for bulk use.

## Develop

Requires Node.js 24. These commands run from `providers/uk-metadata`.

```sh
npm ci
npm test
npm run format:check
npm start
docker build -t bookorbit-uk-metadata:local .
```

The service needs no database, volume, or BookOrbit code. For an offline health probe, query `/health`. For a live edition check, query `/hachette-uk/search?isbn=9780356508191` and `/waterstones/search?isbn=9780356508191` or `/foyles/search?isbn=9780356508191`; with `AUTH_TOKEN` set, include the Authorization header.
