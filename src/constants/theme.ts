export interface Theme {
  bg: string;
  text: string;
  border: string;
  container: string;
  buttonBg: string;
  buttonHover: string;
  cardBg: string;
  cardBorder: string;
  // Additional card colors
  cardText: string;
  cardTitle: string;
  cardAccent: string;
  primary: string;
  statusEnergy: string;
  statusHappiness: string;
  statusExperience: string;
  // Purple accent for special elements
  purple: string;
  purpleHover: string;
}

export const currentTheme = (isDark: boolean): Theme => ({
  bg: isDark 
    ? 'bg-gradient-to-br from-[#1A0F0A] via-[#2A1912] to-[#0D0705]' 
    : 'bg-gradient-to-br from-[#FCF5D8] via-[#F4E4C1] to-[#E8D4B4]',
  text: isDark ? 'text-[#FCF5D8]' : 'text-[#0D0705]',
  border: isDark ? 'border-[#F4860A]/30' : 'border-[#814E33]/30',
  container: isDark ? 'bg-[#814E33]/20' : 'bg-[#814E33]/10',
  buttonBg: isDark ? 'bg-[#814E33]/20' : 'bg-white/50',
  buttonHover: isDark ? 'hover:bg-[#814E33]/30' : 'hover:bg-[#814E33]/10',
  cardBg: isDark ? 'transparent' : 'transparent',
  cardBorder: isDark ? '#F4860A' : '#814E33',
  cardText: isDark ? '#FCF5D8' : '#0D0705',
  cardTitle: isDark ? '#FCF5D8' : '#0D0705',
  cardAccent: isDark ? '#F4860A' : '#814E33',
  primary: isDark ? '#F4860A' : '#814E33', // Same as cardAccent for consistency
  // Keep consistent colors for status bars as they convey meaning
  statusEnergy: '#F59E0B', // amber
  statusHappiness: '#EC4899', // pink
  statusExperience: '#3B82F6', // blue
  // Purple accent for special elements
  purple: isDark ? '#9333EA' : '#7C3AED', // purple-600/purple-700
  purpleHover: isDark ? '#A855F7' : '#8B5CF6' // purple-500/purple-600
});
