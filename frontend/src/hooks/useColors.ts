import { colors } from '@/theme/colors';

export function useColors() {
  // Always return light mode colors - we've removed dark mode
  return colors;
}
