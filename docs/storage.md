# Storage

CinemAItor stores media files on disk and stores metadata in SQLite.

## Layout

```
app_data/
  media/        # content-addressed masters
  previews/     # lightweight previews
  proxies/      # timeline playback proxies
  thumbnails/   # UI thumbnails
  models/       # installed model files
  renders/      # rendered output
  logs/         # runtime and job logs
  cache/        # regenerable cache data
```

## Content-addressed media

Uploaded and generated media is stored under:

```
app_data/media/<hash:0:2>/<hash:2:4>/<sha256>.<ext>
```

Identical content reuses the same stored file. Metadata records the logical filename, MIME type,
format, and content hash.

## Rules

- SQLite stores metadata only.
- Media files are addressed by SHA-256.
- Asset versions reference stored files.
- Temporary upload files are removed on success or failure.
- Restore operations change metadata pointers, not stored files.
