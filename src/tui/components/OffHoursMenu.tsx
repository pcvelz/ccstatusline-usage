import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type { OffHoursConfig, Settings } from '../../types/Settings';
import {
    activeHoursPerWeek,
    formatHHMM,
    offWindowDurationMinutes,
    parseHHMM
} from '../../utils/off-hours';
import { shouldInsertInput } from '../../utils/input-guards';

type EditingField = 'start' | 'end' | null;

const DEFAULT_OFF_HOURS: OffHoursConfig = {
    enabled: false,
    startMinutes: 22 * 60,
    endMinutes: 7 * 60
};

export function getOffHoursOrDefault(settings: Settings): OffHoursConfig {
    return settings.offHours ?? DEFAULT_OFF_HOURS;
}

export function describeOffWindow(offHours: OffHoursConfig): string {
    const duration = offWindowDurationMinutes(offHours.startMinutes, offHours.endMinutes);
    if (duration === 0) {
        return '(no window)';
    }
    const hours = Math.floor(duration / 60);
    const mins = duration % 60;
    const durStr = mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
    return `${formatHHMM(offHours.startMinutes)} → ${formatHHMM(offHours.endMinutes)} (${durStr}/day)`;
}

export function formatActiveHoursPerWeek(offHours: OffHoursConfig): string {
    const hours = activeHoursPerWeek(offHours);
    if (Number.isInteger(hours)) {
        return `${hours}h / week`;
    }
    return `${hours.toFixed(1)}h / week`;
}

export interface OffHoursMenuProps {
    settings: Settings;
    onUpdate: (settings: Settings) => void;
    onBack: () => void;
}

export const OffHoursMenu: React.FC<OffHoursMenuProps> = ({ settings, onUpdate, onBack }) => {
    const offHours = getOffHoursOrDefault(settings);
    const [editing, setEditing] = useState<EditingField>(null);
    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState<string | null>(null);

    const applyOffHours = (next: OffHoursConfig) => {
        onUpdate({ ...settings, offHours: next });
    };

    const beginEdit = (field: EditingField) => {
        if (!field) return;
        const current = field === 'start' ? offHours.startMinutes : offHours.endMinutes;
        setInputValue(formatHHMM(current));
        setEditing(field);
        setError(null);
    };

    const commitEdit = () => {
        if (!editing) return;
        const parsed = parseHHMM(inputValue);
        if (parsed === null) {
            setError('Invalid time. Use HH:MM (e.g., 22:30).');
            return;
        }
        if (editing === 'start') {
            applyOffHours({ ...offHours, startMinutes: parsed });
        } else {
            applyOffHours({ ...offHours, endMinutes: parsed });
        }
        setEditing(null);
        setInputValue('');
        setError(null);
    };

    const cancelEdit = () => {
        setEditing(null);
        setInputValue('');
        setError(null);
    };

    useInput((input, key) => {
        if (editing) {
            if (key.return) {
                commitEdit();
            } else if (key.escape) {
                cancelEdit();
            } else if (key.backspace || key.delete) {
                setInputValue(prev => prev.slice(0, -1));
                setError(null);
            } else if (shouldInsertInput(input, key)) {
                setInputValue(prev => prev + input);
                setError(null);
            }
            return;
        }

        if (key.escape) {
            onBack();
        } else if (input === 'e' || input === 'E') {
            applyOffHours({ ...offHours, enabled: !offHours.enabled });
        } else if (input === 's' || input === 'S') {
            beginEdit('start');
        } else if (input === 'n' || input === 'N') {
            beginEdit('end');
        } else if (input === 'r' || input === 'R') {
            applyOffHours(DEFAULT_OFF_HOURS);
        }
    });

    const windowDesc = describeOffWindow(offHours);
    const activeDesc = formatActiveHoursPerWeek(offHours);

    return (
        <Box flexDirection='column'>
            <Text bold>🌙 Off Hours</Text>
            <Text dimColor>
                Hours you won&apos;t use Claude (e.g., sleep). Weekly Pace holds its expected %
                steady through this window instead of drifting upward.
            </Text>

            {editing ? (
                <Box flexDirection='column' marginTop={1}>
                    <Box>
                        <Text>
                            {editing === 'start' ? 'Enter start time' : 'Enter end time'}
                            {' '}
                            (HH:MM, 24-hour local):
                            {' '}
                        </Text>
                        <Text color='cyan'>{inputValue || '(empty)'}</Text>
                    </Box>
                    {error && (
                        <Text color='red'>{error}</Text>
                    )}
                    <Text dimColor>Press Enter to save, ESC to cancel</Text>
                </Box>
            ) : (
                <>
                    <Box marginTop={1} />
                    <Box>
                        <Text>          Enabled: </Text>
                        <Text color={offHours.enabled ? 'green' : 'red'}>
                            {offHours.enabled ? '✓ Enabled' : '✗ Disabled'}
                        </Text>
                        <Text dimColor> - Press (e) to toggle</Text>
                    </Box>

                    <Box>
                        <Text>       Start Time: </Text>
                        <Text color='cyan'>{formatHHMM(offHours.startMinutes)}</Text>
                        <Text dimColor> - Press (s) to edit</Text>
                    </Box>

                    <Box>
                        <Text>         End Time: </Text>
                        <Text color='cyan'>{formatHHMM(offHours.endMinutes)}</Text>
                        <Text dimColor> - Press (n) to edit</Text>
                    </Box>

                    <Box marginTop={1}>
                        <Text>       Off Window: </Text>
                        <Text color={offHours.enabled ? 'white' : 'gray'}>{windowDesc}</Text>
                    </Box>

                    <Box>
                        <Text>     Active Hours: </Text>
                        <Text color={offHours.enabled ? 'white' : 'gray'}>{activeDesc}</Text>
                    </Box>

                    <Box marginTop={2}>
                        <Text dimColor>Press (r) to reset to defaults (22:00 → 07:00, disabled)</Text>
                    </Box>
                    <Box>
                        <Text dimColor>Press ESC to go back</Text>
                    </Box>

                    <Box marginTop={1} flexDirection='column'>
                        <Text dimColor wrap='wrap'>
                            • Start &gt; End means the window wraps across midnight (e.g., 22:00 → 07:00).
                        </Text>
                        <Text dimColor wrap='wrap'>
                            • Start === End disables the window (treated as empty).
                        </Text>
                        <Text dimColor wrap='wrap'>
                            • dayOfWeek (D1/7…D7/7) still tracks wall-clock time. Only the delta changes.
                        </Text>
                    </Box>
                </>
            )}
        </Box>
    );
};
