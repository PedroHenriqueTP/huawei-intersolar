# Huawei Activations Hub - Legacy Archive

This directory is reserved for archiving previous events, specific campaign logical overrides, or hardcoded scripts that do not conform to the modern modular system design.

By archiving them here, we ensure that:
1. **Core remains clean**: No old single-use endpoints or controllers clutter the main cyberphysical platform core.
2. **Dynamic Loading is maintained**: Specific activation behaviors are encapsulated inside the `src/activations/plugins/` folder rather than main routes.
3. **No performance overhead**: Legacy items are not loaded at runtime by the NestJS application unless explicitly imported.

## Migration Guidelines
To migrate any past specific activation logic here:
1. Create a subfolder with the name of the past event / campaign (e.g., `intersolar-2025/`).
2. Move all specific database models, controllers, and services there.
3. Remove them from the active NestJS module imports in `src/app.module.ts`.
