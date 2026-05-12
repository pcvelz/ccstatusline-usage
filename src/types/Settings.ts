import { z } from 'zod';

import { ColorLevelSchema } from './ColorLevel';
import { FlexModeSchema } from './FlexMode';
import { PowerlineConfigSchema } from './PowerlineConfig';
import { WidgetItemSchema } from './Widget';

// Current version - bump this when making breaking changes to the schema
export const CURRENT_VERSION = 3;

export const InstallationMetadataSchema = z.discriminatedUnion('method', [
    z.object({
        method: z.literal('auto-update'),
        packageManager: z.enum(['npm', 'bun'])
    }),
    z.object({
        method: z.literal('pinned'),
        installedVersion: z.string().optional()
    }),
    z.object({
        method: z.literal('self-managed'),
        packageManager: z.enum(['npm', 'bun', 'unknown']).default('unknown')
    }),
    z.object({
        method: z.literal('unknown'),
        packageManager: z.enum(['npm', 'bun', 'unknown']).default('unknown')
    })
]);

// Schema for v1 settings (before version field was added)
export const SettingsSchema_v1 = z.object({
    lines: z.array(z.array(WidgetItemSchema)).optional(),
    flexMode: FlexModeSchema.optional(),
    compactThreshold: z.number().optional(),
    colorLevel: ColorLevelSchema.optional(),
    defaultSeparator: z.string().optional(),
    defaultPadding: z.string().optional(),
    inheritSeparatorColors: z.boolean().optional(),
    overrideBackgroundColor: z.string().optional(),
    overrideForegroundColor: z.string().optional(),
    globalBold: z.boolean().optional()
});

// Main settings schema with defaults
export const SettingsSchema = z.object({
    version: z.number().default(CURRENT_VERSION),
    lines: z.array(z.array(WidgetItemSchema))
        .min(1)
        .default([
            [
                { id: 'session-usage', type: 'session-usage', color: 'brightBlue' },
                { id: 'sep1', type: 'separator' },
                { id: 'weekly-usage', type: 'weekly-usage', color: 'brightBlue' },
                { id: 'sep2', type: 'separator' },
                { id: 'reset-timer', type: 'reset-timer', color: 'brightBlue' },
                { id: 'sep-battery', type: 'separator' },
                { id: 'battery', type: 'battery', color: 'yellow' },
                { id: 'sep3', type: 'separator' },
                { id: 'model', type: 'model', color: 'magenta' },
                { id: 'sep4', type: 'separator' },
                { id: 'session-id', type: 'claude-session-id', color: 'cyan' }
            ],
            [
                { id: 'context-bar', type: 'context-bar', color: 'blue' },
                { id: 'sep-weekly-pace', type: 'separator' },
                { id: 'weekly-pace', type: 'weekly-pace', color: 'brightBlue', metadata: { display: 'pendulum' } },
                { id: 'sep-off-peak', type: 'separator' },
                { id: 'off-peak', type: 'off-peak', color: 'green' }
            ],
            []
        ]),
    flexMode: FlexModeSchema.default('full-minus-40'),
    compactThreshold: z.number().min(1).max(99).default(60),
    colorLevel: ColorLevelSchema.default(2),
    defaultSeparator: z.string().optional(),
    defaultPadding: z.string().optional(),
    inheritSeparatorColors: z.boolean().default(false),
    overrideBackgroundColor: z.string().optional(),
    overrideForegroundColor: z.string().optional(),
    globalBold: z.boolean().default(false),
    minimalistMode: z.boolean().default(false),
    powerline: PowerlineConfigSchema.default({
        enabled: false,
        separators: ['\uE0B0'],
        separatorInvertBackground: [false],
        startCaps: [],
        endCaps: [],
        theme: undefined,
        autoAlign: false,
        continueThemeAcrossLines: false
    }),
    updatemessage: z.object({
        message: z.string().nullable().optional(),
        remaining: z.number().nullable().optional()
    }).optional(),
    installation: InstallationMetadataSchema.optional()
});

// Inferred type from schema
export type Settings = z.infer<typeof SettingsSchema>;
export type InstallationMetadata = z.infer<typeof InstallationMetadataSchema>;
export type ResolvedInstallationMetadata
    = | Exclude<InstallationMetadata, { method: 'pinned' }>
        | (Extract<InstallationMetadata, { method: 'pinned' }> & { packageManager: 'npm' | 'bun' | 'unknown' });

// Export a default settings constant for reference
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
