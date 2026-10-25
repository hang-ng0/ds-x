import type { Tool } from './settings'

export const COLORS = [
  { name: 'Red', value: '#ff3b30' },
  { name: 'Orange', value: '#ff9500' },
  { name: 'Yellow', value: '#ffcc00' },
  { name: 'Green', value: '#34c759' },
  { name: 'Blue', value: '#007aff' },
  { name: 'Purple', value: '#af52de' },
  { name: 'Pink', value: '#ff2d92' },
  { name: 'Brown', value: '#8b5a2b' },
  { name: 'Black', value: '#222222' },
]

export const BRUSHES = [8, 18, 36]

export const TOOLS: { tool: Tool; name: string; label: string; icon: string }[] = [
  { tool: 'pointer', name: 'Pointer', label: 'Pointer: one finger paints', icon: '☝️' },
  // { tool: 'fingers', name: 'Fingers', label: 'Fingers: every finger you hold out paints', icon: '✌️' },
  { tool: 'palm', name: 'Handprint', label: 'Handprint: your whole hand paints', icon: '✋' },
  // { tool: 'auto', name: 'Auto', label: 'Auto: brush follows your hand shape', icon: '✨' },
]
