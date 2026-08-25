# blog-feed

Static aggregate feed for smallyu's blogs.

Sources:

- `blog`: `https://smallyu.net/atom.xml`
- `blog-b`: `https://b.smallyu.net/atom.xml`
- `blog-crazy`: `https://crazy.smallyu.net/atom.xml`
- `old-blog`: `https://old-blog.smallyu.net/auto.xml`
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

The GitHub Actions workflow rebuilds immediately when a source repository sends
the `source_updated` repository dispatch event. A once-per-day schedule remains
as a low-frequency fallback, and refreshed feed output is committed only when it
changes.

After each build, the workflow compares the generated feed with the IDs recorded
in `data/telegram-state.json`. Unsent items are sent to the Telegram channel in
chronological order. The initial state is empty, so the first run backfills the
entire feed; later runs send only newly discovered items. Delivery is paced to
stay within Telegram rate limits. Telegram delivery uses these Actions secrets
in `blog-feed`:

- `TELEGRAM_BOT_TOKEN`: token for the channel publisher bot
- `TELEGRAM_CHANNEL_ID`: numeric Telegram channel ID

Each successfully delivered item is checkpointed. The workflow commits those
checkpoints even when a later item fails, then reports the run as failed. A later
run therefore resumes with only the remaining unsent items.

Source repositories use an Actions secret named
`BLOG_FEED_DISPATCH_TOKEN`. It should be a fine-grained GitHub token limited to
the `smallyunet/blog-feed` repository with `Contents: write`, which is the
permission required to create a repository dispatch event.
