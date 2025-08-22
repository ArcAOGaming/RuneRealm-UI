import React from 'react';
import { currentTheme } from "../../constants/theme";

interface Props {
  darkMode: boolean;
}

const Loading: React.FC<Props> = ({ darkMode }) => {
  const theme = currentTheme(darkMode);
  
  return (
    <div className={`flex justify-center items-center ${theme.text}`}>
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-current"></div>
    </div>
  );
};

export default Loading;
