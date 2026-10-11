import {
    Box,
    Text,
    useInput
} from 'ink';
import React, {
    useRef,
    useState
} from 'react';

import type { MatchSegment } from '../../utils/fuzzy';
import { shouldInsertInput } from '../../utils/input-guards';

const MAX_VISIBLE_OPTIONS = 10;

export interface SearchableOption {
    value: string;
    displayName: string;
    description: string;
}

interface SearchableOptionEditorProps<T extends SearchableOption> {
    title: string;
    currentLabel: string;
    // The value of the option selected on open; the first option if none matches
    initialValue: string | null;
    options: T[];
    filterOptions: (options: T[], query: string) => T[];
    getMatchSegments: (text: string, query: string) => MatchSegment[];
    emptyMessage: string;
    onSelect: (value: string) => void;
    onCancel: () => void;
}

function getInitialSelectedIndex(options: SearchableOption[], selectedValue: string | null): number {
    const selectedIndex = options.findIndex(option => option.value === selectedValue);
    return selectedIndex === -1 ? 0 : selectedIndex;
}

function getVisibleRange(selectedIndex: number, totalOptions: number): { start: number; end: number } {
    if (totalOptions <= MAX_VISIBLE_OPTIONS) {
        return { start: 0, end: totalOptions };
    }

    const halfWindow = Math.floor(MAX_VISIBLE_OPTIONS / 2);
    const maxStart = totalOptions - MAX_VISIBLE_OPTIONS;
    const start = Math.min(Math.max(0, selectedIndex - halfWindow), maxStart);
    return { start, end: start + MAX_VISIBLE_OPTIONS };
}

// The selected row is all green; other rows highlight the letters that match
function getSegmentColor(isSelected: boolean, matched: boolean): string | undefined {
    if (isSelected) {
        return 'green';
    }

    return matched ? 'yellowBright' : undefined;
}

// The list behind the reset timers' locale and timezone editors: type to
// search, Up/Down to select, Enter to save, ESC to cancel. Each editor
// supplies its options, how to search them, and its labels.
export function SearchableOptionEditor<T extends SearchableOption>({
    title,
    currentLabel,
    initialValue,
    options,
    filterOptions,
    getMatchSegments,
    emptyMessage,
    onSelect,
    onCancel
}: Readonly<SearchableOptionEditorProps<T>>): React.ReactElement {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(() => getInitialSelectedIndex(options, initialValue));
    // Typed text and Enter can arrive before a re-render, so input handling reads
    // the latest query and selection from refs instead of the render-time values.
    const queryRef = useRef(query);
    const indexRef = useRef(selectedIndex);
    const updateQuery = (next: string) => {
        queryRef.current = next;
        indexRef.current = 0;
        setQuery(next);
        setSelectedIndex(0);
    };
    const updateIndex = (next: number) => {
        indexRef.current = next;
        setSelectedIndex(next);
    };

    const filteredOptions = filterOptions(options, query);
    const clampedSelectedIndex = filteredOptions.length === 0
        ? 0
        : Math.min(selectedIndex, filteredOptions.length - 1);
    const visibleRange = getVisibleRange(clampedSelectedIndex, filteredOptions.length);
    const visibleOptions = filteredOptions.slice(visibleRange.start, visibleRange.end);

    useInput((input, key) => {
        if (key.return) {
            const latest = filterOptions(options, queryRef.current);
            const option = latest[Math.min(indexRef.current, Math.max(latest.length - 1, 0))];
            if (option) {
                onSelect(option.value);
            }
            return;
        }

        if (key.escape) {
            onCancel();
            return;
        }

        if (key.upArrow || key.downArrow) {
            const count = filterOptions(options, queryRef.current).length;
            if (count === 0) {
                return;
            }

            const current = Math.min(indexRef.current, count - 1);
            const next = key.downArrow
                ? (current + 1 > count - 1 ? 0 : current + 1)
                : (current - 1 < 0 ? count - 1 : current - 1);
            updateIndex(next);
            return;
        }

        if (key.backspace || key.delete) {
            updateQuery(queryRef.current.slice(0, -1));
            return;
        }

        if (shouldInsertInput(input, key)) {
            updateQuery(queryRef.current + input);
        }
    });

    return (
        <Box flexDirection='column'>
            <Box>
                <Text bold>{title}</Text>
                <Text dimColor>
                    {' '}
                    Current:
                    {' '}
                    {currentLabel}
                </Text>
            </Box>
            <Box>
                <Text dimColor>Search: </Text>
                <Text color='cyan'>{query || '(none)'}</Text>
            </Box>
            <Text dimColor>Type to search, Up/Down select, Enter save, ESC cancel</Text>
            <Box marginTop={1} flexDirection='column'>
                {filteredOptions.length === 0 ? (
                    <Text dimColor>{emptyMessage}</Text>
                ) : (
                    visibleOptions.map((option, visibleIndex) => {
                        const actualIndex = visibleRange.start + visibleIndex;
                        const isSelected = actualIndex === clampedSelectedIndex;
                        const segments = getMatchSegments(option.displayName, query);

                        return (
                            <Box key={option.value} flexDirection='row' flexWrap='nowrap'>
                                <Box width={3}>
                                    <Text color={isSelected ? 'green' : undefined}>
                                        {isSelected ? '> ' : '  '}
                                    </Text>
                                </Box>
                                {segments.map((segment, index) => (
                                    <Text
                                        key={index}
                                        color={getSegmentColor(isSelected, segment.matched)}
                                        bold={isSelected ? true : segment.matched}
                                    >
                                        {segment.text}
                                    </Text>
                                ))}
                                <Text dimColor>
                                    {' '}
                                    -
                                    {' '}
                                    {option.description}
                                </Text>
                            </Box>
                        );
                    })
                )}
            </Box>
            {filteredOptions.length > MAX_VISIBLE_OPTIONS && (
                <Box marginTop={1}>
                    <Text dimColor>
                        Showing
                        {' '}
                        {visibleRange.start + 1}
                        -
                        {visibleRange.end}
                        {' '}
                        of
                        {' '}
                        {filteredOptions.length}
                    </Text>
                </Box>
            )}
        </Box>
    );
}
