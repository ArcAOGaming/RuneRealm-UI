import { SPRITE_CATEGORIES, PUBLIC_ASSETS_PATH, type SpriteCategory } from '../constants/spriteAssets';

export async function scanAssets(): Promise<SpriteCategory[]> {
  const categories = [...SPRITE_CATEGORIES];
  
  for (const category of categories) {
    try {
      // Try to load the index file for this category
      const indexPath = `${PUBLIC_ASSETS_PATH}/${category.folder}/index.json`;
      let files: string[] = [];
      
      try {
        const response = await fetch(indexPath);
        if (response.ok) {
          files = await response.json();
        } else {
          console.warn(`No index.json found for ${category.name}, will try to load none.png directly`);
        }
      } catch (error) {
        console.warn(`Error loading index.json for ${category.name}: ${error}`);
      }

      // Always check for none.png
      const nonePath = `${PUBLIC_ASSETS_PATH}/${category.folder}/none.png`;
      try {
        const noneResponse = await fetch(nonePath);
        if (!noneResponse.ok) {
          console.warn(`Missing none.png for category: ${category.name}`);
        }
      } catch (error) {
        console.warn(`Error checking none.png for ${category.name}: ${error}`);
      }

      // Update options, ensuring 'none' is always first
      category.options = ['none'];
      const pngFiles = files
        .filter(file => file.toLowerCase().endsWith('.png'))
        .map(file => file.replace('.png', '').toLowerCase());
      
      // Add other files, excluding 'none' since it's already first
      category.options.push(...pngFiles.filter(file => file !== 'none'));
      
    } catch (error) {
      console.error(`Error scanning assets for ${category.name}:`, error);
      // Ensure category always has at least 'none' as an option
      category.options = ['none'];
    }
  }
  
  return categories;
}

export function getAssetPath(category: string, asset: string): string {
  if (!asset || asset.toLowerCase() === 'none') {
    return `${PUBLIC_ASSETS_PATH}/${category}/none.png`;
  }
  return `${PUBLIC_ASSETS_PATH}/${category}/${asset}.png`;
}
