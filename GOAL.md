# Product Proposal: Local AI Movie Studio

**Working Title:** Local AI Movie Studio\
**Document Type:** Product Goal Document / Feature Specification\
**Version:** 0.1 Draft\
**Status:** For internal review and roadmap planning

---

## 1. Executive Summary

We are proposing a **local-first web application** for creating movies with the help of AI.

For the rest of this document when mentioning "local", what we really mean is user controlled. So
self hosted is also local. The video models could be running on a separate system from the users
local machine, but still be under the user's control (e.g. they build their own AI inference
dedicated server). Also it should be possible to have the backend and frontend of this product to be
running on a (user controlled) cloud server, while using AI models hosted in their private network
running "in house" (similar to how github can use self hosted runners for their github actions)

The product will allow users to:

- Create movie projects
- Store and manage assets
- Generate assets using local AI models
- Upload, edit, and version assets
- Reference assets using unique `@` names
- Build storyboards and scenes
- Generate video, audio, music, and visual elements
- Edit scenes on a timeline
- Generate or import music and sound
- Version-control creative work
- Create and reuse “skills”
- Install and manage open-source local models
- Optionally use third-party paid APIs when local generation is insufficient

The product’s primary focus is **local model AI generation**, with 3rd party cloud APIs treated as
optional fallbacks or extensions.

This document defines:

- Product vision
- Scope
- Core workflows
- Feature requirements
- Module specifications
- Data model
- Technical constraints
- MVP roadmap
- Success criteria
- Risks and open questions

---

# 2. Product Vision

The goal is to build a practical AI movie creation studio that works primarily on the user’s
controlled hardware.

It should feel like a professional creative tool, not just a prompt box.

The product should support a complete workflow:

```text
Idea → Script/Storyboard → Assets → AI Generation → Editing → Audio/Music → Render → Versioned Output
```

The end result should be a usable movie project with:

- Reusable assets
- Reproducible AI generations
- Non-destructive editing
- Version history
- Clear provenance
- Exportable final media

---

# 3. Target Users

## Primary users

- Indie filmmakers
- Short-form creators
- AI artists
- Students
- Creative professionals experimenting with local AI
- Small teams producing AI-assisted content

## Secondary users

- Marketers creating product videos
- Educators creating explainer videos
- Musicians creating music videos
- Game creators producing cinematic assets
- Local privacy-focused creators who do not want to send media to the cloud

---

# 4. Core Problems We Are Solving

1. **AI video tools are fragmented.**\
   Users need multiple tools for image generation, video generation, audio, editing, and export.

2. **AI generation is hard to organize.**\
   Without asset management, projects become unmanageable quickly.

3. **Local/user controlled AI is underutilized in creative workflows.**\
   Most tools push users to cloud APIs. We want user controlled models to be the default path.

4. **Versioning and provenance are missing.**\
   Users need to restore previous generations, prompts, edits, and outputs.

5. **Reference-driven creation is not standard.**\
   Users should be able to say things like:

   ```text
   @person walks into @room and stops at @table
   ```

   and have the system understand the referenced assets.

---

# 5. Product Goals

## 5.1 Primary Goals

- Enable users to create a complete movie project locally
- Support reusable, shareable assets across projects
- Allow AI generation of images, video, audio, music, and 3D assets
- Provide a structured storyboard and scene system
- Provide a timeline-based editor for assembling the movie
- Support `@asset` references inside prompts
- Provide full version history for assets, prompts, scenes, edits, and exports
- Support local model installation and management
- Support reusable AI workflows through “skills”
- Allow optional cloud API fallback where needed

## 5.2 Non-Goals for v1

The first version will not be:

- A full non-linear editor replacing DaVinci Resolve or Premiere
- A full digital audio workstation
- A full 3D animation suite
- A distributed render farm
- A real-time multi-user collaboration platform
- A marketplace for user-generated content
- A generic AI chat app

However, the architecture should allow these to be added later.

---

# 6. Guiding Principles

## 6.1 Local-first

- Core workflow must work offline
- Local models are the default
- Cloud APIs are optional and clearly consented to
- User media should not leave the machine unless explicitly requested

## 6.2 Non-destructive

- Original assets should be preserved
- Edits should be stored as operations or versions
- Users should be able to roll back changes

## 6.3 Versioned

- Assets, prompts, scenes, edits, and exports should have version history
- Users should be able to restore older states
- Generation outputs should be traceable

## 6.4 Reproducible

- Every generated asset should record:
  - Prompt
  - Model
  - Settings
  - Seed
  - Input references
  - Version
  - Timestamp

## 6.5 Model-agnostic

- The app should not depend on one model family
- It should support multiple local backends and open-source models
- It should abstract model differences behind a common interface

## 6.6 Extensible

- Skills should allow reusable workflows
- Plugins should be possible in later versions
- The system should support new model types without rewriting the core

## 6.7 Proxy-based for performance

- Heavy files should have lightweight proxies
- Timelines should use proxies for playback
- Final renders should use masters where possible

---

# 7. High-Level Product Architecture

The product should be divided into separate modules.

## 7.1 Core Modules

| Module                  | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| Project Manager         | Create and manage movie projects                            |
| Asset Library           | Store, organize, version, and reference assets              |
| Reference Engine        | Resolve `@asset` references inside prompts and scenes       |
| Generation Orchestrator | Manage AI generation jobs                                   |
| Model Manager           | Install, configure, and manage local models                 |
| Skill Engine            | Create and run reusable AI workflows                        |
| Storyboard Module       | Plan shots and scenes visually                              |
| Scene Module            | Define scenes with prompts, references, and generated media |
| Timeline Editor         | Assemble clips, audio, overlays, and effects                |
| Audio Engine            | Manage dialogue, voiceover, SFX, music, and mixing          |
| Render / Export Module  | Produce final output files                                  |
| Version Control System  | Track and restore project states                            |
| Storage Manager         | Handle media files, caches, proxies, and backups            |
| Diagnostics             | Track errors, hardware status, and model health             |

## 7.2 Optional Modules

| Module              | Purpose                                 |
| ------------------- | --------------------------------------- |
| Cloud Gateway       | Call third-party APIs when enabled      |
| Collaboration Sync  | Share projects and assets               |
| Review Board        | Candidate comparison and approval       |
| Continuity Analyzer | Detect visual and audio inconsistencies |
| Script Parser       | Convert scripts into scenes and shots   |
| AI Assistant        | Help with prompts, planning, and review |

---

# 8. Core User Workflow

The primary user flow should be:

1. **Create a movie project**
   - Name, aspect ratio, frame rate, resolution, output settings

2. **Create or import assets**
   - Characters, locations, props, voices, music, 3D models, references

3. **Name assets**
   - Each asset gets a unique `@name`

4. **Create storyboard**
   - Panels or shots
   - Camera direction
   - Duration
   - Mood
   - References

5. **Create scenes**
   - Prompts with `@asset` references
   - Shot list
   - Audio plan

6. **Generate assets**
   - Images
   - Video
   - Audio
   - Music
   - 3D

7. **Review generations**
   - Compare candidates
   - Approve or reject
   - Regenerate if needed

8. **Edit on timeline**
   - Order clips
   - Trim
   - Add transitions
   - Add audio
   - Add subtitles
   - Apply effects

9. **Generate or import music**
   - Generate score based on the cut
   - Or import music manually

10. **Render and export**

- Draft or final
- Different formats
- Version the output

11. **Version everything**

- Restore previous prompts, scenes, edits, or exports

---

# 9. Feature Specification

The following defines the features we want, grouped by module.

Priority:

- **P0** = must have for MVP
- **P1** = important for early product completeness
- **P2** = later expansion

---

## 9.1 Project Management

### Purpose

Allow users to create and manage movie projects.

### Features

| Priority | Feature               | Specification                                                               |
| -------- | --------------------- | --------------------------------------------------------------------------- |
| P0       | Create project        | User can create a new movie project with name and settings                  |
| P0       | Project settings      | Aspect ratio, frame rate, resolution, audio settings, default export preset |
| P0       | Open project          | Open previously saved projects                                              |
| P0       | Save project          | Save project state locally                                                  |
| P0       | Close project         | Close active project safely                                                 |
| P0       | Rename project        | Change project name without breaking asset references                       |
| P0       | Delete project        | Soft delete or archive first, with warning                                  |
| P1       | Duplicate project     | Create copy of project, optionally with new asset references                |
| P1       | Project templates     | Start from templates such as short film, social reel, music video           |
| P1       | Project import/export | Export/import project bundle including metadata, optionally media           |
| P1       | Project backup        | Create local backup or archive                                              |
| P2       | Project comparison    | Compare two project versions at high level                                  |

### Project specification

A project should define:

- Project ID
- Name
- Description
- Creation date
- Last modified date
- Media directory
- Output directory
- Default aspect ratio
- Default frame rate
- Default resolution
- Default color space
- Default audio sample rate
- Default export preset
- Default model preferences
- Template used, if any
- Version history

### Acceptance criteria

- A user can create a project, add assets, save, close, and reopen it successfully
- Missing media files should be detected and reported
- Project deletion should require confirmation and should not silently delete shared global assets

---

## 9.2 Asset Library

### Purpose

Provide a centralized library for assets that can be reused across projects.

### Core idea

Assets are not just files.\
An asset is a versioned, metadata-rich object that can be referenced in prompts, scenes,
storyboards, and timelines.

### Features

| Priority | Feature                     | Specification                                              |
| -------- | --------------------------- | ---------------------------------------------------------- |
| P0       | Global asset library        | Store assets outside individual projects                   |
| P0       | Project asset library       | Allow assets scoped to a specific project                  |
| P0       | Upload assets               | Upload images, video, audio, 3D, fonts, LUTs, subtitles    |
| P0       | Generate assets             | Create new assets using AI                                 |
| P0       | Asset metadata              | Store type, description, tags, source, license, provenance |
| P0       | Asset versions              | Keep multiple versions per asset                           |
| P0       | Asset preview               | Show thumbnail, waveform, 3D preview, or clip preview      |
| P0       | Asset search                | Search by name, tag, type, project, date                   |
| P0       | Asset naming                | Unique `@name` per asset                                   |
| P1       | Asset collections           | Organize assets into folders or smart collections          |
| P1       | Asset tags                  | Multi-tag assets for discovery                             |
| P1       | Asset filtering             | Filter by type, status, project, date, license, resolution |
| P1       | Asset duplication           | Duplicate asset or version                                 |
| P1       | Asset replacement           | Replace media for a specific asset version                 |
| P1       | Asset dependency tracking   | Show which projects/scenes use an asset                    |
| P1       | Missing reference detection | Warn if an asset is deleted but still referenced           |
| P1       | Asset license tracking      | Store rights and usage restrictions                        |
| P2       | Asset marketplace           | Optional local or online skill/asset sharing               |
| P2       | Batch operations            | Batch rename, tag, move, delete, export                    |

### Asset types

Supported asset types should include:

- Image
- Video
- Audio
- Dialogue
- Voiceover
- Music
- Sound effect
- 3D model
- Texture
- Font
- LUT / color grade
- Subtitle file
- Prompt template
- Style reference
- Character sheet
- Voice profile
- Effect preset
- Project template

### Asset specification

Each asset should include:

- Internal immutable ID
- Display name
- Unique reference name, e.g. `@person`
- Optional aliases
- Asset type
- Description
- Tags
- Source type: uploaded, generated, imported, derived
- License / rights status
- Attribution text
- Parent asset, if derived
- Related assets
- Version list
- Preview asset
- Master file path
- Proxy file path
- Checksum
- File size
- Format
- Technical specs:
  - Resolution
  - Duration
  - Frame rate
  - Sample rate
  - Channels
  - Color space
  - 3D format
- Status: draft, approved, rejected, archived
- Notes
- Created date
- Updated date

### Acceptance criteria

- A user can upload an image and reference it as `@person`
- A user can generate a new version of that asset
- A user can see all versions
- A user can restore an older version
- If an asset is used in a scene, deleting it should produce a warning
- Assets can be reused across multiple projects

---

## 9.3 Asset Versioning

### Purpose

Ensure users can always return to previous versions of assets.

### Features

| Priority | Feature               | Specification                                            |
| -------- | --------------------- | -------------------------------------------------------- |
| P0       | Version creation      | New version created when asset is changed or regenerated |
| P0       | Version list          | Show all versions of an asset                            |
| P0       | Restore version       | Restore any previous version as active                   |
| P0       | Version notes         | Add notes to a version                                   |
| P0       | Version preview       | Preview each version                                     |
| P1       | Version comparison    | Compare two versions side by side                        |
| P1       | Version pinning       | Pin a specific version for use in a scene                |
| P1       | Version status        | Mark version as approved, rejected, draft                |
| P1       | Version history graph | Show how versions are related                            |
| P2       | Version branching     | Allow experimental branches from a version               |

### Version specification

Each version should include:

- Version ID
- Asset ID
- Version number
- File path
- Checksum
- Size
- Format
- Technical specs
- Created date
- Author
- Source job ID, if generated
- Prompt used, if generated
- Model used, if generated
- Seed, if applicable
- Input asset versions used
- Notes
- Status

### Acceptance criteria

- If a user regenerates an asset, the old version remains available
- A user can restore the previous version with one action
- A user can see what changed between versions
- A scene can reference a specific asset version if needed

---

## 9.4 Reference System

### Purpose

Allow users to reference assets in prompts, scenes, and storyboards using `@name`.

### Example

```text
@person walks into @room and stops at @table
```

### Features

| Priority | Feature                    | Specification                                                                         |
| -------- | -------------------------- | ------------------------------------------------------------------------------------- |
| P0       | `@asset` reference parsing | Detect and parse `@name` tokens in prompts                                            |
| P0       | Unique asset names         | Each asset reference name must be unique                                              |
| P0       | Reference resolution       | Map `@name` to asset and active version                                               |
| P0       | Missing reference warning  | Warn if a referenced asset does not exist                                             |
| P0       | Reference roles            | Allow references to have roles such as character, location, prop, style, voice, music |
| P1       | Versioned references       | Support `@asset:v2` or similar                                                        |
| P1       | Aliases                    | Allow one asset to have multiple `@` names                                            |
| P1       | Reference suggestions      | Suggest assets while typing                                                           |
| P1       | Reference replacement      | Replace a broken reference with another asset                                         |
| P1       | Reference audit            | List all references in a project or scene                                             |
| P2       | Reference namespaces       | Support scoped names like `@project1/person`                                          |

### Reference roles

References should be able to specify how an asset is used:

- Character
- Person
- Face
- Voice
- Location
- Room
- Environment
- Prop
- Object
- Style
- Lighting
- Mood
- Camera
- Motion
- Music
- SFX
- Ambience
- 3D model
- Texture
- Color palette

### Reference specification

A reference object should include:

- Reference ID
- Prompt or scene ID
- Asset ID
- Asset version ID, optional
- Role
- Raw text
- Start / end position, optional
- Status: resolved, missing, ambiguous
- Notes

### Acceptance criteria

- When a user types `@person`, the system resolves it to the correct asset
- If `@person` is deleted, the system warns before deletion
- A user can replace `@old_person` with `@new_person`
- A prompt can specify that `@style_cinematic` is a style reference, not a character

---

## 9.5 AI Generation

### Purpose

Generate assets using local AI models, with optional cloud fallback.

### Supported generation types

| Type               | Priority | Notes                                          |
| ------------------ | -------- | ---------------------------------------------- |
| Text-to-image      | P0       | Core image generation                          |
| Image-to-image     | P0       | Variation, restyling, editing                  |
| Text-to-video      | P1       | Depends on local model availability            |
| Image-to-video     | P0       | Often more reliable than text-to-video locally |
| Reference-to-video | P0       | Often more reliable than text-to-video locally |
| Video-to-video     | P1       | Restyling, upscale, motion transfer            |
| Text-to-audio      | P1       | SFX or short audio generation                  |
| Music generation   | P1       | Mood-based score generation                    |
| Voice generation   | P1       | Voiceover or dialogue                          |
| 3D generation      | P2       | Local 3D generation is advanced                |
| Upscaling          | P1       | Image/video super resolution                   |
| Denoising          | P1       | Video/image cleanup                            |
| Background removal | P1       | Useful for character/prop assets               |

### Features

| Priority | Feature                    | Specification                                              |
| -------- | -------------------------- | ---------------------------------------------------------- |
| P0       | Generate image from prompt | Create image asset version                                 |
| P0       | Generate video from image  | Create short video clip from image and prompt              |
| P0       | Generate video from prompt | If supported by installed model                            |
| P0       | Generate audio             | Generate SFX or short audio                                |
| P0       | Generation job             | Every generation creates a job                             |
| P0       | Job queue                  | Jobs run sequentially or with limited concurrency          |
| P0       | Job status                 | Queued, running, processing, succeeded, failed, cancelled  |
| P0       | Job progress               | Show progress where possible                               |
| P0       | Job cancel                 | User can cancel active job                                 |
| P0       | Job retry                  | Retry failed jobs                                          |
| P0       | Seed control               | Allow fixed or random seed                                 |
| P0       | Prompt versioning          | Store prompt used for generation                           |
| P0       | Negative prompts           | Support negative prompt if model supports it               |
| P0       | Reference inputs           | Allow images, styles, audio, voice, 3D references          |
| P1       | Variation generation       | Generate multiple candidates from same prompt              |
| P1       | A/B comparison             | Compare two or more generated outputs                      |
| P1       | Batch generation           | Generate multiple shots or assets                          |
| P1       | Generation presets         | Save preferred settings                                    |
| P1       | Preview generation         | Generate low-resolution preview first                      |
| P1       | Full-quality generation    | Generate final asset after preview approval                |
| P2       | Predicted generation time  | Estimate duration based on model and hardware              |
| P2       | Cloud fallback             | Optionally send job to cloud if local fails or is too slow |

### Generation specification

Each generation should produce:

- Generation job ID
- Project ID
- Asset ID
- Optional scene ID
- Optional shot ID
- Prompt
- Prompt version
- Negative prompt
- Model ID
- Model version
- Input asset versions
- Reference roles
- Seed
- Settings
- Output asset version
- Status
- Error, if any
- Progress
- Estimated time
- Actual duration
- Created timestamp
- Finished timestamp

### Acceptance criteria

- User can generate an image from a prompt and add it to the asset library
- User can generate a short video from an image
- User can see generation job status
- User can cancel a job
- User can retry a failed job
- Every generated asset stores the prompt, model, seed, and inputs
- Generated assets can be referenced by `@name`

---

## 9.6 Model Manager

### Purpose

Allow users to install, configure, verify, and manage local AI models.

This is a core module because the product is local-model focused.

### Features

| Priority | Feature                    | Specification                                                           |
| -------- | -------------------------- | ----------------------------------------------------------------------- |
| P0       | Model registry             | Keep list of installed models                                           |
| P0       | Install model              | Download and install local model                                        |
| P0       | Remove model               | Remove model and clean metadata                                         |
| P0       | Enable/disable model       | Toggle model availability                                               |
| P0       | Model metadata             | Store name, version, task, license, backend, requirements, capabilities |
| P0       | Model health check         | Test whether model loads and runs                                       |
| P0       | Model task mapping         | Associate model with supported tasks                                    |
| P1       | Model search               | Search local or remote catalog                                          |
| P1       | Model verification         | Checksum or signature validation                                        |
| P1       | Model update               | Update to newer version                                                 |
| P1       | Model rollback             | Return to previous model version                                        |
| P1       | Model benchmark            | Run test generation to measure speed/quality                            |
| P1       | Model presets              | Save recommended settings for a model                                   |
| P1       | Missing dependency warning | Warn if model dependencies are missing                                  |
| P1       | License display            | Show model license clearly                                              |
| P2       | Model auto-install         | Install missing model when first needed                                 |
| P2       | Model recommendation       | Recommend models based on task and hardware                             |
| P2       | Model marketplace          | Browse optional model sources                                           |

### Model metadata

Each model should include:

- Model ID
- Name
- Version
- Source
- Repository URL
- File hash
- License
- Task types
- Input types
- Output types
- Supported resolution
- Supported frame rate
- Supported duration
- VRAM requirement
- RAM requirement
- Backend
- Dependencies
- Default parameters
- Example prompts
- Known limitations
- Enabled state
- Installation date
- Last used date

### Acceptance criteria

- A user can install a local text-to-image model
- The app can verify the model is installed and usable
- If a model fails, the app can show a clear error
- A user can remove a model
- A model can be associated with multiple generation tasks
- The app should not silently use a model the user did not install

---

## 9.7 Skill System

### Purpose

Allow users to create and reuse repeatable AI workflows.

A skill is not just a prompt.\
It is a reusable workflow that may combine prompts, models, assets, settings, and edit operations.

### Examples

- `cinematic_character_intro`
- `dark_mood_scene`
- `vertical_reel_export`
- `footsteps_sfx_generator`
- `tense_score_generator`
- `character_consistency_enforcer`
- `local_video_upscaler`
- `room_lighting_fixer`

### Features

| Priority | Feature              | Specification                                       |
| -------- | -------------------- | --------------------------------------------------- |
| P0       | Create skill         | Define reusable workflow                            |
| P0       | Run skill            | Execute skill on selected assets or scenes          |
| P0       | Skill parameters     | Accept inputs such as asset, prompt, mood, duration |
| P0       | Skill versioning     | Version skills separately                           |
| P0       | Enable/disable skill | Toggle skill availability                           |
| P1       | Skill metadata       | Name, description, author, version, license         |
| P1       | Skill input schema   | Define required and optional inputs                 |
| P1       | Skill output schema  | Define what the skill produces                      |
| P1       | Skill permissions    | Declare required permissions                        |
| P1       | Skill examples       | Include sample input/output                         |
| P1       | Skill testing        | Test skill against sample data                      |
| P1       | Skill import/export  | Export skill as portable file                       |
| P2       | Skill marketplace    | Local or community skill sharing                    |
| P2       | Skill sandbox        | Run skills in restricted environment                |
| P2       | Skill chaining       | Combine multiple skills into a pipeline             |

### Skill specification

A skill should define:

- Skill ID
- Name
- Version
- Description
- Author
- License
- Input schema
- Output schema
- Required models
- Required permissions
- Required hardware
- Prompt templates
- Generation steps
- Edit operations
- Render settings
- Examples
- Test cases
- Logs
- Enabled state

### Acceptance criteria

- A user can create a skill that generates a tense music track
- A user can run the skill on a scene
- The skill produces a new asset version
- The skill can be reused in another project
- Skill version changes should be visible

---

## 9.8 Storyboard Module

### Purpose

Allow users to plan the movie before or during generation.

The storyboard is part of the movie project.

### Features

| Priority | Feature                  | Specification                                  |
| -------- | ------------------------ | ---------------------------------------------- |
| P0       | Create storyboard        | Create storyboard per project                  |
| P0       | Add storyboard panel     | Add panel representing a shot                  |
| P0       | Panel prompt             | Write prompt for panel                         |
| P0       | Panel references         | Add `@asset` references                        |
| P0       | Panel duration           | Define expected duration                       |
| P0       | Panel preview            | Attach generated image or video preview        |
| P0       | Panel status             | Draft, approved, generated, needs revision     |
| P1       | Camera direction         | Specify shot size, angle, movement             |
| P1       | Mood / lighting          | Specify mood, time of day, lighting            |
| P1       | Dialogue / VO            | Attach dialogue or voiceover text              |
| P1       | Music / SFX              | Attach audio plan                              |
| P1       | Transition               | Define transition to next panel                |
| P1       | Notes                    | Add creative notes                             |
| P1       | Panel ordering           | Reorder panels                                 |
| P1       | Storyboard export        | Export as PDF, PNG, ZIP, or image sequence     |
| P2       | AI storyboard generation | Generate storyboard from script or description |

### Storyboard panel specification

Each panel should include:

- Panel ID
- Storyboard ID
- Order
- Shot number
- Description
- Prompt
- Prompt version
- Duration
- Camera settings
- Characters
- Locations
- Props
- Mood
- Lighting
- Time of day
- Dialogue
- Voiceover
- Music cue
- SFX
- Transition
- Notes
- Status
- Preview asset version
- Generated clip asset version
- Linked scene
- Linked shot
- Created date
- Updated date

### Acceptance criteria

- A user can create a storyboard with multiple panels
- Each panel can reference assets using `@names`
- A user can generate a preview image for a panel
- A user can mark a panel as approved
- A user can export the storyboard

---

## 9.9 Scene and Shot Module

### Purpose

Allow users to define scenes that use prompts and references.

A scene is part of the movie project.

### Features

| Priority | Feature                 | Specification                                 |
| -------- | ----------------------- | --------------------------------------------- |
| P0       | Create scene            | Create scene within project                   |
| P0       | Scene prompt            | Write prompt using `@asset` references        |
| P0       | Scene references        | Resolve and list referenced assets            |
| P0       | Scene generation        | Generate media from scene prompt              |
| P0       | Scene status            | Draft, generated, editing, approved, rejected |
| P0       | Scene versioning        | Save scene prompt and structure changes       |
| P0       | Scene duration          | Define target duration                        |
| P1       | Shot list               | Break scene into multiple shots               |
| P1       | Shot prompts            | Each shot can have its own prompt             |
| P1       | Shot references         | Each shot can use specific references         |
| P1       | Shot duration           | Define duration per shot                      |
| P1       | Shot status             | Track shot generation status                  |
| P1       | Scene audio plan        | Define dialogue, SFX, music for scene         |
| P1       | Scene notes             | Add notes to scene                            |
| P2       | Scene consistency check | Compare shots in scene for consistency        |
| P2       | Scene re-generation     | Regenerate selected shots only                |

### Scene specification

A scene should include:

- Scene ID
- Project ID
- Optional storyboard ID
- Name
- Description
- Prompt
- Prompt version
- References
- Target duration
- Aspect ratio override, optional
- Frame rate override, optional
- Status
- Notes
- Audio plan
- Shot list
- Generated asset versions
- Timeline item, if used
- Created date
- Updated date
- Version history

### Acceptance criteria

- A user can create a scene with prompt:

  ```text
  @person walks into @room and stops at @table
  ```

- The app resolves `@person`, `@room`, and `@table`
- The user can generate a video clip from the scene
- The generated clip is stored as an asset version
- The scene can be regenerated with a new prompt or new model
- Older scene prompts remain available

---

## 9.10 Timeline Editor

### Purpose

Allow users to edit and assemble the movie.

This is where the movie is actually built.

### Features

| Priority | Feature             | Specification                                    |
| -------- | ------------------- | ------------------------------------------------ |
| P0       | Timeline view       | Show clips on tracks                             |
| P0       | Add clip            | Add generated or uploaded clip to timeline       |
| P0       | Reorder clips       | Drag clips to change order                       |
| P0       | Trim clips          | Adjust in/out points                             |
| P0       | Delete clip         | Remove clip from timeline                        |
| P0       | Duplicate clip      | Duplicate clip item                              |
| P0       | Playback            | Play selected range or full timeline             |
| P0       | Timeline versioning | Save timeline states                             |
| P0       | Undo / redo         | Support undo and redo for timeline actions       |
| P1       | Split clip          | Split at playhead                                |
| P1       | Transitions         | Add fade, dissolve, cut, wipe                    |
| P1       | Video tracks        | Multiple video tracks                            |
| P1       | Audio tracks        | Dialogue, VO, music, SFX, ambience tracks        |
| P1       | Text overlay        | Add titles, credits, lower thirds                |
| P1       | Subtitles           | Add or burn subtitles                            |
| P1       | Effects             | Apply blur, color, grain, glow, etc.             |
| P1       | Color grading       | Apply LUTs or grade clips                        |
| P1       | Markers             | Add markers and notes                            |
| P1       | Lock / mute tracks  | Lock or mute tracks                              |
| P1       | Nest sequences      | Group clips into nested sequences                |
| P2       | AI reframe          | Automatically reframe for different aspect ratio |
| P2       | Auto cut            | Suggest cuts based on beats or audio             |
| P2       | Multi-cam           | Future expansion                                 |

### Timeline specification

A timeline should include:

- Timeline ID
- Project ID
- Name
- Version
- Duration
- Tracks
- Items
- Markers
- Settings
- Created date
- Updated date
- Snapshot history

### Track types

- Video
- Dialogue
- Voiceover
- Music
- SFX
- Ambience
- Overlay
- Text
- Subtitle
- Effect
- Transition

### Clip item specification

Each timeline item should include:

- Item ID
- Timeline ID
- Track ID
- Asset version ID
- Start time
- End time
- Offset in source media
- Speed
- Transform
- Fade in
- Fade out
- Transition
- Effect chain
- Color grade
- Audio settings
- Notes
- Status

### Acceptance criteria

- A user can place generated clips on a timeline
- A user can reorder and trim clips
- A user can add a simple audio track
- A user can export a basic cut
- Timeline changes can be undone
- A user can save multiple timeline versions

---

## 9.11 Audio and Music Module

### Purpose

Manage all audio in the movie.

Music is one part, but the full product should support:

- Dialogue
- Voiceover
- Sound effects
- Ambience
- Music
- Audio mixing
- Audio-visual sync

### Features

| Priority | Feature                | Specification                                     |
| -------- | ---------------------- | ------------------------------------------------- |
| P0       | Import audio           | Import WAV, MP3, etc.                             |
| P0       | Audio asset versioning | Version audio files                               |
| P0       | Add audio to timeline  | Place audio on tracks                             |
| P0       | Audio trim             | Trim audio clips                                  |
| P0       | Basic volume control   | Adjust gain per clip                              |
| P1       | Generate music         | Generate music from prompt or mood                |
| P1       | Generate SFX           | Generate sound effects                            |
| P1       | Generate voiceover     | Generate voice from text                          |
| P1       | Music stems            | Separate drums, bass, melody, etc. if supported   |
| P1       | Music mood matching    | Generate music based on selected mood             |
| P1       | Audio cleanup          | Denoise, normalize, de-ess                        |
| P1       | Audio mixing           | Basic mixer with tracks                           |
| P1       | Ducking                | Lower music under dialogue                        |
| P1       | Sync audio to video    | Align audio with visual actions                   |
| P1       | Subtitle generation    | Generate subtitles from dialogue                  |
| P2       | AI watch-movie music   | Analyze assembled cut and generate matching score |
| P2       | Auto SFX               | Suggest or generate SFX from video actions        |
| P2       | Voice cloning          | Generate voice from reference, with consent       |

### Music specification

A music asset should include:

- Music ID
- Name
- Mood
- Tempo
- Key
- Energy
- Duration
- Instrumentation
- Emotion
- Loopable
- Stems
- Prompt
- Model
- Version
- Rights
- Scene suitability
- Created date

### Acceptance criteria

- A user can import a music file and place it on the timeline
- A user can generate a tense music track locally
- A user can adjust music volume
- A user can generate a simple voiceover
- A user can generate subtitles from generated voiceover
- The system can duck music under dialogue in a basic mix

---

## 9.12 Video Generation Controls

### Purpose

Expose useful controls for video generation.

### Features

| Priority | Feature               | Specification                             |
| -------- | --------------------- | ----------------------------------------- |
| P0       | Duration              | Define clip duration                      |
| P0       | Resolution            | Define output resolution                  |
| P0       | Frame rate            | Define output FPS                         |
| P0       | Aspect ratio          | Define output ratio                       |
| P0       | Prompt                | Main generation prompt                    |
| P0       | References            | Attach reference assets                   |
| P0       | Model                 | Select local model                        |
| P1       | Seed                  | Fixed or random seed                      |
| P1       | Guidance strength     | If supported                              |
| P1       | Motion strength       | If supported                              |
| P1       | Camera movement       | Static, dolly, pan, zoom, orbit, handheld |
| P1       | First frame           | Use image as first frame                  |
| P1       | Last frame            | Use image as last frame if supported      |
| P1       | Style consistency     | Attach style references                   |
| P1       | Character consistency | Attach character references               |
| P2       | Negative motion       | Suppress unwanted motion                  |
| P2       | Physics constraints   | Basic constraints where supported         |
| P2       | Camera path           | Advanced camera path definition           |

### Acceptance criteria

- User can generate a 4-second, 720p, 24 FPS clip from an image
- User can attach a character reference
- User can regenerate the same prompt with different seed
- User can compare generated variations

---

## 9.13 3D Asset Support

### Purpose

Allow 3D models to be used as references and generated assets.

3D is valuable, but full 3D production is out of scope for v1.

### Features

| Priority | Feature             | Specification                               |
| -------- | ------------------- | ------------------------------------------- |
| P0       | Import 3D model     | Import GLB, FBX, OBJ, USD/USDZ, etc.        |
| P0       | 3D preview          | Rotate, scale, pan in viewport              |
| P0       | 3D asset versioning | Version 3D files                            |
| P1       | Export 3D views     | Render front, side, top, perspective images |
| P1       | Use as reference    | Use 3D-derived images in prompts            |
| P1       | 3D to video         | Generate video from 3D model views          |
| P1       | Format conversion   | Convert between supported 3D formats        |
| P2       | 3D generation       | Generate 3D from image/text                 |
| P2       | 3D animation        | Basic transform animation                   |
| P2       | 3D lighting         | Add simple lighting/environment             |
| P2       | 3D material editing | Basic material tweaks                       |

### Acceptance criteria

- A user can import a `.glb` table model
- The app can preview it
- The app can export front/side/top images
- Those images can be referenced as `@table_front`, `@table_side`
- The 3D model can be used as a reference for video generation

---

## 9.14 Review and Approval Workflow

### Purpose

Help users select the best AI-generated results.

AI generation will often produce multiple imperfect candidates.\
The app should make review simple.

### Features

| Priority | Feature           | Specification                                           |
| -------- | ----------------- | ------------------------------------------------------- |
| P0       | Candidate view    | Show generated candidates for a job                     |
| P0       | Approve           | Mark candidate as approved                              |
| P0       | Reject            | Mark candidate as rejected                              |
| P0       | Use candidate     | Place approved candidate into asset library or timeline |
| P1       | A/B comparison    | Compare two candidates side by side                     |
| P1       | Before/after      | Compare original and edited asset                       |
| P1       | Notes             | Add review notes                                        |
| P1       | Shortlist         | Mark favorites                                          |
| P1       | Review board      | Review many shots or assets in one view                 |
| P2       | Continuity report | Detect inconsistencies across shots                     |
| P2       | Quality checklist | Run checklist for artifacts, sync, lighting, etc.       |

### Acceptance criteria

- A user can generate 4 variations
- A user can compare them
- A user can approve one
- The approved version becomes the active asset version
- Rejected versions remain available for review

---

## 9.15 Version Control System

### Purpose

Allow users to restore older versions of creative work.

Version control should cover more than files.

### Features

| Priority | Feature              | Specification                                 |
| -------- | -------------------- | --------------------------------------------- |
| P0       | Asset versioning     | Versions for assets                           |
| P0       | Prompt versioning    | Versions for prompts                          |
| P0       | Scene versioning     | Versions for scene structure and prompt       |
| P0       | Timeline snapshot    | Save timeline state                           |
| P0       | Restore version      | Restore selected version                      |
| P1       | Project snapshot     | Snapshot entire project state                 |
| P1       | Version comparison   | Compare two versions                          |
| P1       | Version notes        | Explain changes                               |
| P1       | Version history view | Visual history of changes                     |
| P1       | Export versioning    | Version exported files separately             |
| P2       | Branching            | Experimental branches for scenes or timelines |
| P2       | Merge suggestions    | Suggest merging branches                      |

### Versioned objects

- Assets
- Asset versions
- Prompts
- Scenes
- Shots
- Storyboards
- Timelines
- Audio mixes
- Export presets
- Projects

### Acceptance criteria

- A user can change a scene prompt, regenerate, then restore the previous prompt
- A user can save a timeline snapshot before adding music
- A user can restore the timeline from before music was added
- A user can see what changed between snapshots

---

## 9.16 Render and Export Module

### Purpose

Produce final output media.

### Features

| Priority | Feature           | Specification                                      |
| -------- | ----------------- | -------------------------------------------------- |
| P0       | Export video      | Render timeline to video file                      |
| P0       | Export presets    | Basic draft and final presets                      |
| P0       | Render queue      | Queue export jobs                                  |
| P0       | Render progress   | Show progress                                      |
| P0       | Render log        | Show errors and warnings                           |
| P1       | Multiple exports  | Export same timeline in multiple formats           |
| P1       | Audio export      | Export audio separately                            |
| P1       | Subtitle export   | Export sidecar subtitles                           |
| P1       | Storyboard export | Export storyboard as PDF/images                    |
| P1       | Project export    | Export project bundle                              |
| P1       | Render validation | Check for missing media, sync issues, black frames |
| P2       | HDR export        | HDR output where supported                         |
| P2       | Archival master   | High-quality master export                         |
| P2       | Batch export      | Export multiple projects                           |

### Export preset specification

Each preset should include:

- Preset ID
- Name
- Container
- Video codec
- Resolution
- Frame rate
- Bitrate
- Color space
- Pixel format
- Audio codec
- Audio sample rate
- Audio bitrate
- Subtitle burn-in
- Watermark
- Metadata
- Output folder
- File naming pattern

### Acceptance criteria

- A user can export a draft 720p MP4
- A user can export a final 1080p MP4
- A user can export audio as WAV
- A user can export subtitles as SRT
- If media is missing, the render should fail with a clear report

---

# 10. Data Model Specification

The following is a conceptual data model.

This is not database code, but the entities and relationships the product should support.

---

## 10.1 Core Entities

### Project

```text
Project
- id
- name
- description
- media_directory
- output_directory
- aspect_ratio
- frame_rate
- resolution
- color_space
- audio_sample_rate
- default_export_preset
- default_model_preferences
- template_id
- created_at
- updated_at
```

### Asset

```text
Asset
- id
- library_scope
  - global
  - project
- project_id nullable
- name
- display_name
- unique_slug
- aliases
- asset_type
- description
- tags
- license
- rights_status
- source_type
- status
- parent_asset_id nullable
- preview_version_id
- active_version_id
- created_at
- updated_at
```

### AssetVersion

```text
AssetVersion
- id
- asset_id
- version_number
- file_path
- format
- checksum
- file_size
- technical_metadata
- status
- notes
- created_at
- created_by
- generation_job_id nullable
```

### GenerationJob

```text
GenerationJob
- id
- project_id
- asset_id nullable
- scene_id nullable
- shot_id nullable
- job_type
- model_id
- model_version
- prompt
- negative_prompt
- seed
- settings
- input_asset_versions
- reference_roles
- status
- progress
- error
- output_asset_version_id nullable
- created_at
- started_at
- finished_at
```

### Reference

```text
Reference
- id
- source_type
  - prompt
  - scene
  - shot
  - storyboard_panel
- source_id
- asset_id
- asset_version_id nullable
- role
- raw_text
- status
- notes
```

### Storyboard

```text
Storyboard
- id
- project_id
- name
- status
- created_at
- updated_at
```

### StoryboardPanel

```text
StoryboardPanel
- id
- storyboard_id
- order
- shot_number
- description
- prompt
- duration
- camera_settings
- mood
- lighting
- transition
- status
- preview_asset_version_id nullable
- linked_shot_id nullable
- notes
```

### Scene

```text
Scene
- id
- project_id
- storyboard_id nullable
- name
- description
- prompt
- prompt_version_id
- status
- target_duration
- notes
- audio_plan
- created_at
- updated_at
```

### Shot

```text
Shot
- id
- scene_id
- order
- prompt
- duration
- camera_settings
- status
- generated_asset_version_id nullable
- notes
```

### Timeline

```text
Timeline
- id
- project_id
- name
- version
- duration
- settings
- created_at
- updated_at
```

### Track

```text
Track
- id
- timeline_id
- track_type
- name
- order
- locked
- muted
```

### TimelineItem

```text
TimelineItem
- id
- timeline_id
- track_id
- asset_version_id
- start
- end
- source_offset
- speed
- transform
- effect_chain
- transition
- notes
```

### TimelineSnapshot

```text
TimelineSnapshot
- id
- timeline_id
- name
- snapshot_data
- notes
- created_at
```

### Model

```text
Model
- id
- name
- version
- source
- task_types
- license
- backend
- file_hash
- requirements
- default_settings
- enabled
- installed_at
- last_used_at
```

### Skill

```text
Skill
- id
- name
- version
- description
- author
- license
- input_schema
- output_schema
- required_model_ids
- permissions
- enabled
- created_at
- updated_at
```

### RenderJob

```text
RenderJob
- id
- project_id
- timeline_id
- preset_id
- status
- progress
- error
- output_path nullable
- created_at
- started_at
- finished_at
```

### Export

```text
Export
- id
- project_id
- render_job_id
- file_path
- format
- settings
- created_at
```

### ProjectSnapshot

```text
ProjectSnapshot
- id
- project_id
- name
- description
- snapshot_data
- checksum
- created_at
```

---

# 11. Technical Specifications

## 11.1 Platform Targets

### Initial target

- Web application
  - Deno backend
  - SQLite database
  - Vanilla Javascript, web components, shadow dom frontend, no build steps
- Primary hosting OS:
  - Linux

### Hardware targets

| Tier           | Target                         | Use case                                       |
| -------------- | ------------------------------ | ---------------------------------------------- |
| Baseline       | 8–16 GB RAM, CPU only          | Basic image/audio generation, editing          |
| Recommended    | 16–32 GB RAM, 8–12 GB GPU VRAM | Local image-to-video, audio, music             |
| Advanced       | 32+ GB RAM, 24+ GB GPU VRAM    | Higher-resolution generation, faster iteration |
| Cloud-assisted | Local + API                    | Long or high-quality video when user opts in   |

The app should detect hardware and adjust recommendations.

---

## 11.2 Local Inference

The product should support a local inference layer.

### Required inference capabilities

- Text-to-image
- Image-to-image
- Image-to-video
- Text-to-video where possible
- Text-to-audio
- Music generation
- Voice synthesis
- Upscaling
- Denoising
- Speech-to-text
- LLM-based prompt assistance
- LLM harnass for assisted model installation

### Backend support

The product should abstract backends behind a model runtime interface.

---

## 11.3 Media Formats

### Initial Image import

- PNG
- JPG
- EXR
- BMP
- WebP

### Video import

- MP4
- MOV
- MKV
- AVI
- WebM
- H.264
- H.265
- ProRes
- DNx

### Audio import

- WAV
- MP3
- FLAC
- AIFF
- OGG
- M4A
- AAC

### 3D import

- GLB
- GLTF
- FBX
- OBJ
- USD
- USDZ
- STL

### Text / subtitle import

- TXT
- CSV
- JSON
- SRT
- VTT

### Export

- MP4
- MOV
- MKV
- WebM
- GIF
- WAV
- MP3
- FLAC
- SRT
- VTT
- PDF
- PNG
- JPG
- ZIP project bundle

---

## 11.4 Proxy and Master Workflow

The product should separate:

- **Master media**: highest quality source
- **Proxy media**: lightweight version for editing
- **Preview media**: low-resolution generation previews

### Suggested proxy strategy

| Type  | Master                 | Proxy                           |
| ----- | ---------------------- | ------------------------------- |
| Video | 1080p/4K, high bitrate | 720p or 1080p low bitrate H.264 |
| Audio | WAV / FLAC             | MP3 or AAC preview              |
| Image | Original PNG/EXR       | JPG preview                     |
| 3D    | Source model           | Lightweight preview mesh        |

### Requirements

- Timeline should use proxies by default
- Final render should use masters where available
- Missing masters should be detected before final export
- Proxies should be regenerable

---

## 11.5 Storage Model

### Recommended storage layout

```text
app_data/
  projects/
    project_id/
      project.json
      metadata/
      snapshots/
  assets/
    asset_id/
      versions/
        v1/
        v2/
      previews/
      proxies/
  models/
    model_id/
      weights/
      metadata/
  cache/
    thumbnails/
    render_cache/
    inference_cache/
  logs/
```

### Storage features

- Content-addressed file storage where practical
- Checksums for integrity
- Duplicate detection
- Orphaned file cleanup
- Cache cleanup
- Storage usage report
- Retention policies
- Optional compression

---

## 11.6 Performance Targets

These are proposed targets for the recommended hardware tier.

| Task                         | Target                               |
| ---------------------------- | ------------------------------------ |
| App startup                  | Under 5 seconds                      |
| Project open                 | Under 2 seconds for medium project   |
| Asset thumbnail generation   | Under 1 second per image             |
| Timeline scrubbing           | Smooth playback using proxies        |
| Generation job status update | At least every 1 second              |
| Prompt reference resolution  | Under 100 ms for normal project size |
| Search results               | Under 500 ms for 10,000 assets       |
| Draft render                 | Start within 10 seconds              |
| Error reporting              | Clear error in under 5 seconds       |

---

## 11.7 Security and Privacy

### Local-first requirements

- No cloud upload by default
- Local storage by default
- Clear consent before any network call
- API keys stored securely
- Optional project encryption
- Optional asset encryption
- Audit log for sensitive actions
- Sandboxed skill execution
- Model signature or checksum verification

### Optional cloud policy

If cloud APIs are used:

- User must explicitly enable
- Show what data will be sent
- Allow per-task opt-in
- Track usage
- Allow cost warnings
- Allow provider selection
- Allow fallback chain

---

# 12. UX and Core Screens

The app should have the following core screens.

---

## 12.1 Project Dashboard

Purpose: manage projects.

Contents:

- Create project
- Open recent projects
- Search projects
- Project status
- Template gallery
- Settings
- Model manager shortcut
- Storage usage

---

## 12.2 Asset Library

Purpose: manage assets.

Contents:

- Asset grid or list
- Search
- Filters
- Upload button
- Generate button
- Asset details
- Version history
- Tags
- Collections
- Dependencies
- Preview panel

---

## 12.3 Storyboard Editor

Purpose: plan shots.

Contents:

- Panels
- Panel ordering
- Prompt editor
- Reference picker
- Camera controls
- Duration
- Mood
- Preview image/video
- Status
- Notes
- Export

---

## 12.4 Scene Inspector

Purpose: manage a scene.

Contents:

- Scene prompt
- References
- Shot list
- Generated clips
- Audio plan
- Notes
- Version history
- Generate button
- Review status

---

## 12.5 Timeline Editor

Purpose: assemble the movie.

Contents:

- Video tracks
- Audio tracks
- Clip thumbnails
- Waveforms
- Playhead
- Markers
- Effects
- Subtitles
- Preview monitor
- Undo/redo
- Timeline versions

---

## 12.6 Generation Queue

Purpose: monitor AI jobs.

Contents:

- Active jobs
- Queued jobs
- Failed jobs
- Progress
- Cancel
- Retry
- Logs
- Hardware status
- Model status

---

## 12.7 Review Board

Purpose: approve or reject AI outputs.

Contents:

- Candidate grid
- A/B comparison
- Approve / reject
- Notes
- Shortlist
- Use in timeline
- Regenerate

---

## 12.8 Model Manager

Purpose: manage local models.

Contents:

- Installed models
- Available models
- Install / remove
- Health check
- License
- Hardware requirements
- Model presets
- Benchmark results
- Cloud provider settings

---

## 12.9 Settings and Diagnostics

Purpose: configure app and troubleshoot.

Contents:

- Storage paths
- GPU settings
- Model settings
- Network / cloud settings
- Privacy settings
- Backup settings
- Diagnostics report
- Logs
- Hardware info

---

# 13. Non-Functional Requirements

## 13.1 Reliability

- The app should not lose work on crash
- Auto-save should be supported
- Projects should recover from interrupted saves
- Generation jobs should be resumable or retryable

## 13.2 Recoverability

- Users should be able to restore:
  - Asset versions
  - Prompts
  - Scenes
  - Timelines
  - Projects
- Deleted items should have a recovery path where possible

## 13.3 Privacy

- Local-first by default
- No silent uploads
- Clear consent for cloud processing
- Local logs should be inspectable

## 13.4 Extensibility

- New model types should be addable
- New asset types should be addable
- Skills should be reusable
- Export formats should be addable

## 13.5 Determinism

- Where possible, generation should be reproducible using:
  - Prompt
  - Model
  - Seed
  - Settings
  - Inputs

## 13.6 Diagnostics

- The app should collect:
  - Hardware info
  - Model load errors
  - GPU errors
  - Disk errors
  - Missing dependency errors
  - Render errors
- Diagnostics should be exportable for support

## 13.7 Accessibility

- Keyboard navigation
- Adjustable text size
- High contrast mode
- Screen reader support where feasible
- Audio descriptions where feasible

## 13.8 Localization

- UI localization should be possible
- Prompt examples should be localizable
- Voice generation should support multiple languages later

---

# 14. MVP Roadmap

We should not build everything at once.\
The recommended approach is phased.

---

## Phase 0: Validation and Foundations

Goal: prove core architecture.

### Deliverables

- Web app skeleton
- Local storage structure
- Project create/open/save
- Asset upload
- Asset versioning
- Basic local model manager
- Text-to-image generation
- Basic job queue
- Basic `@asset` parsing
- Basic timeline with one video track
- Basic MP4 export

### Exit criteria

- A user can create a project
- Upload an image
- Generate another image
- Reference both with `@names`
- Place clips on a timeline
- Export a video

---

## Phase 1: Core Movie Pipeline

Goal: allow a simple end-to-end AI movie.

### Deliverables

- Global asset library
- Asset metadata
- Asset search
- Prompt versioning
- Image-to-video generation
- Video generation job queue
- Storyboard with panels
- Scene prompts with references
- Basic review board
- Timeline with audio track
- Basic music import
- Basic export presets
- Project snapshots
- Model install / remove
- Basic error recovery

### Exit criteria

- A user can create a short 30-second movie using:
  - Uploaded assets
  - Generated assets
  - Storyboard
  - Scenes
  - Timeline
  - Music
  - Export

---

## Phase 2: Professional Workflow

Goal: make the tool comfortable for repeated creative work.

### Deliverables

- Multi-track audio
- Sound effects
- Voiceover generation
- Music generation
- Color grading
- Transitions
- Text overlays
- Subtitles
- A/B comparison
- Version comparison
- Proxy workflow
- Batch generation
- Skill system v1
- Template system
- Asset dependency tracking
- Broken reference repair
- Storage management
- Diagnostics report

### Exit criteria

- A user can produce a polished short video with:
  - Multiple shots
  - Dialogue or voiceover
  - Music
  - Subtitles
  - Color grade
  - Multiple export versions

---

## Phase 3: Advanced Local AI Studio

Goal: expand into more advanced AI film production.

### Deliverables

- AI assistant
- Script-to-movie
- Continuity analysis
- AI “watch the movie” music
- Music stems
- Auto-mix
- Advanced 3D pipeline
- 3D-to-video
- Voice profiles
- Lip-sync
- Multilingual dubbing
- Cloud fallback
- Advanced skill chaining
- Team review
- HDR export
- Archival masters
- Advanced render pipeline

### Exit criteria

- A user can import a script and generate a structured draft movie
- The app can suggest or generate matching music after a cut is assembled
- The app can detect and report continuity issues
- The app can export high-quality masters

---

# 15. Priority Matrix

## P0 Features

These are required for a usable MVP.

- Project create/save/open
- Asset upload
- Asset library
- Asset versioning
- Unique `@asset` names
- Basic prompt editor
- Reference resolution
- Local model manager
- Text-to-image generation
- Image-to-video generation
- Generation job queue
- Basic storyboard
- Basic scenes
- Basic timeline
- Basic video export
- Basic audio import
- Basic version history
- Error reporting

## P1 Features

These make the product genuinely useful.

- Global asset library
- Asset search and tags
- Prompt versioning
- Variation generation
- A/B review
- Audio tracks
- Music generation
- Voiceover generation
- SFX
- Transitions
- Color grading
- Subtitles
- Text overlays
- Proxy workflow
- Batch generation
- Skill system v1
- Project templates
- Storage management
- Model benchmark
- Broken reference handling

## P2 Features

These expand the product into a full studio.

- Script-to-movie
- AI assistant
- Continuity analysis
- AI music from assembled cut
- Music stems
- Auto-mix
- Advanced 3D
- Lip-sync
- Multilingual dubbing
- Cloud fallback
- Team review
- HDR
- Advanced render
- Skill marketplace
- Real-time collaboration

---

# 16. Acceptance Criteria for the Product

The product is successful for MVP if a user can complete this flow:

1. Create a project
2. Upload a character image and name it `@person`
3. Upload a room image and name it `@room`
4. Upload a table image and name it `@table`
5. Generate a new character variation
6. Restore the previous character version if needed
7. Create a storyboard
8. Add a scene prompt:

   ```text
   @person walks into @room and stops at @table
   ```

9. Generate a short video clip
10. Review the generated clip
11. Add the clip to the timeline
12. Add a music track
13. Export a draft video
14. See the generation history and restore a previous version

If this flow works reliably, the core product vision is validated.

---

# 17. Success Metrics

## Product metrics

- Time from project creation to first exported draft
- Number of assets reused across projects
- Number of scenes generated per project
- Number of exports per project
- Percentage of generated assets approved
- Percentage of failed generation jobs
- Average generation time
- User retention

## Technical metrics

- App crash rate
- Render success rate
- Missing reference error rate
- Model load success rate
- Storage growth per project
- Proxy playback smoothness
- Job queue throughput
- Diagnostics usefulness

## Creative metrics

- Number of storyboard panels created
- Number of storyboard panels approved
- Number of A/B comparisons
- Number of version restorations
- Number of music generations
- Number of skill runs

---

# 18. Risks and Mitigations

## 18.1 Local video generation is slow

**Risk:**\
Local video models may be too slow for comfortable iteration.

**Mitigation:**

- Generate low-resolution previews first
- Use short clips
- Use image-to-video rather than text-to-video where possible
- Allow proxy-based review
- Provide cloud fallback

---

## 18.2 Character consistency is hard

**Risk:**\
AI may not keep characters consistent across shots.

**Mitigation:**

- Character reference system
- Character sheets
- Face / identity references
- Style and costume references
- Model-specific consistency features
- Review board
- Versioning and regeneration

---

## 18.3 Storage grows quickly

**Risk:**\
Media, proxies, models, and generated versions can fill disk space.

**Mitigation:**

- Proxy workflow
- Cache cleanup
- Duplicate detection
- Storage usage dashboard
- Retention policies
- Optional archive / compression

---

## 18.4 Model licensing is complex

**Risk:**\
Some open-source models have unclear or restrictive licenses.

**Mitigation:**

- Store license per model
- Display license clearly
- Block or warn on incompatible commercial use
- Verify checksums
- Prefer reputable model sources

---

## 18.5 Hardware variance is high

**Risk:**\
Users will have very different GPUs and memory.

**Mitigation:**

- Hardware detection
- Recommended model list per hardware tier
- Model health check
- Estimated job time
- Fallback models
- Clear error messages

---

## 18.6 Scope creep

**Risk:**\
The product could become too large too quickly.

**Mitigation:**

- Strict MVP scope
- Phased roadmap
- Separate P0/P1/P2
- Focus on end-to-end workflow first
- Defer advanced collaboration and 3D

---

# 19. questions

## 19.1 Hardware minimum

- What is the minimum supported GPU?
- Is CPU-only mode acceptable for MVP? Answer: CPU only is acceptable

## 19.2 Video length

- What is the maximum initial clip length?
- 2 seconds? 4 seconds? 8 seconds? Answer: This is model dependent, allow max as allowed by model

## 19.3 Cloud policy

- Should cloud APIs be present in v1?
- Or only after local workflow is stable? Answer: No cloud APIs in v1, just local

## 19.4 Skill format

- Should skills be JSON/YAML workflows first?
- Or should they support code/plugins immediately? Answer: JSON/YAML

## 19.5 Collaboration

- Is v1 strictly single-user?
- Should project sharing be file-based only? Answer: Add authorization of assets, projects etc to
  initial designs, but don't implement sharing yet

## 19.6 Asset naming scope

- Are `@names` globally unique or project-scoped?
- Recommended: globally unique with aliases. Answer: globally unique with aliases.

## 19.7 Versioning model

- Do we need branching?
- Or are linear versions plus snapshots enough for MVP? Answer: linear versions plus snapshots is
  enough for MVP

## 19.8 Music generation depth

- Is v1 music generation prompt-based only?
- Or should we attempt “watch the movie and generate music” in v1? Answer: Start with
  prompt/mood-based music. Add assembled-cut analysis later.

## 19.9 3D depth

- Is v1 3D import/preview only?
- Or should 3D-to-video be included early? Answer:Import, preview, export views, use as reference
  first.

---

# 20. Recommended MVP Definition

For the first stable version, I recommend defining MVP as:

## MVP Name

**Local AI Movie Studio – Core Movie Pipeline**

## MVP Scope

- Web app
- Local-first
- Single user
- Project creation
- Global and project asset libraries
- Asset upload
- Asset versioning
- `@asset` references
- Local model installation
- Text-to-image
- Image-to-video
- Basic generation queue
- Storyboard
- Scenes with prompts
- Basic timeline
- Basic audio track
- MP4 export
- Project snapshots
- Basic error recovery

## MVP Non-Scope

- Full DAW
- Full NLE feature parity
- Advanced 3D animation
- Real-time collaboration
- Cloud-first generation
- Marketplace
- Advanced skill scripting
- HDR
- Lip-sync
- Script-to-movie

## MVP Success Definition

A user can create a short AI-assisted movie locally using generated and uploaded assets, with clear
version history and exportable output.

---

# 21. Final Recommendation

The product should be built as a **local AI movie production system**, not merely a generator.

The most important foundations are:

1. **Asset library with versioning**
2. **Reference engine for `@assets`**
3. **Generation job pipeline**
4. **Local model manager**
5. **Storyboard and scene structure**
6. **Timeline editing**
7. **Audio and music workflow**
8. **Render/export pipeline**
9. **Version control for creative work**
10. **Proxy-based media handling**

If these are done well, the product can support:

- Short films
- Music videos
- Social videos
- Product videos
- Experimental AI films
- Story-driven content
- Local privacy-focused creation

The long-term vision should be a complete local studio where users can go from idea to finished,
versioned, exported movie using AI, local models, reusable assets, and repeatable skills.
