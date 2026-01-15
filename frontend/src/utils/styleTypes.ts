import { StyleSheet, TextStyle, ViewStyle, ImageStyle } from 'react-native';

// Helper function to create style sheets with correct types
export const createStyleSheet = <T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(
  styles: T
): T => StyleSheet.create<T>(styles);

// Type for the stylesheet object
export type StyleSheetType<T extends Record<string, ViewStyle | TextStyle | ImageStyle>> =
  ReturnType<typeof StyleSheet.create<T>>;

// Type helper for component style props
export type StyleProp<T> = T | T[];
