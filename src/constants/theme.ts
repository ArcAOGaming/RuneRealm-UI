export interface Theme {
  bg: string;
  text: string;
  border: string;
  container: string;
  buttonBg: string;
  buttonHover: string;
}

export const currentTheme = (isDark: boolean): Theme => ({
  bg: isDark 
    ? 'bg-gradient-to-br from-[#1A0F0A] via-[#2A1912] to-[#0D0705]' 
    : 'bg-gradient-to-br from-[#FCF5D8] via-[#F4E4C1] to-[#E8D4B4]',
  text: isDark ? 'text-[#FCF5D8]' : 'text-[#0D0705]',
  border: isDark ? 'border-[#F4860A]/30' : 'border-[#814E33]/30',
  container: isDark ? 'bg-[#814E33]/20' : 'bg-white/50',
  buttonBg: isDark ? 'bg-[#814E33]/20' : 'bg-white/50',
  buttonHover: isDark ? 'hover:bg-[#814E33]/30' : 'hover:bg-[#814E33]/10'
});
