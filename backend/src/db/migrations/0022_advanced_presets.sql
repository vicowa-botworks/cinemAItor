-- Migration 0022: advanced export presets (MS-8: advanced exports)
--
-- Two more seeded presets for the render pipeline:
--   preset-master  archival-quality h264 master (CRF 17, slow preset)
--   preset-hdr     HEVC HLG 10-bit wide-gamut preset (needs libx265 in ffmpeg)
--
-- Existing databases get them here; fresh databases and test setups that
-- wipe rows get them via ensureDefaultPresets() in db/renders.ts.

INSERT OR IGNORE INTO render_presets (id, name, kind, output_format, resolution, frame_rate, codec, audio_codec, bitrate, settings_json, created_at, updated_at) VALUES
  ('preset-master', 'Master 1080p60 (HQ)', 'final', 'mp4', '1920x1080', 60, 'h264', 'aac', '25000k',
   '{"crf":17,"preset":"slow","pix_fmt":"yuv420p"}',
   datetime('now'), datetime('now')),
  ('preset-hdr', 'HDR 1080p60 (HEVC HLG)', 'final', 'mp4', '1920x1080', 60, 'hevc', 'aac', '25000k',
    '{"crf":20,"preset":"slow","pix_fmt":"yuv420p10le","color":{"primaries":"bt2020","transfer":"arib-std-b67","space":"bt2020nc"}}',
   datetime('now'), datetime('now'));
