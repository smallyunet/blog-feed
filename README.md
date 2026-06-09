# blog-feed

Static aggregate feed for smallyu's blogs.

Sources:

- `blog`: `https://smallyu.net/atom.xml`
- `blog-b`: `https://b.smallyu.net/atom.xml`
- `blog-crazy`: `https://crazy.smallyu.net/atom.xml`
- `blog-micro`: `https://t.smallyu.net/data/*.json`

When the same article appears in both `blog` and `blog-b`, the generated feed keeps the `blog` item and drops the duplicate `blog-b` item.

The build script prefers local sibling folders when they exist, then falls back to the public URLs. This keeps local development fast while allowing GitHub Actions to build the feed in an isolated repository checkout.

## Commands

```sh
npm install
npm run build
npm run serve
```

Open `http://localhost:4000` after starting the local server.

## Output

- `data/feed.json`: data used by the static page
- `atom.xml`: aggregate Atom subscription feed

The GitHub Actions workflow runs once per day and commits refreshed feed output when it changes.
