export interface ImportedAddress {
    address: string;
    timestamp?: number;
}

export const parseAddressCSV = (csvContent: string): ImportedAddress[] => {
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
    return lines.map(line => ({
        address: line.trim(),
        timestamp: Date.now()
    }));
};

export const validateAddresses = (addresses: ImportedAddress[]): { valid: ImportedAddress[], invalid: string[] } => {
    const valid: ImportedAddress[] = [];
    const invalid: string[] = [];
    
    addresses.forEach(({ address }) => {
        // Basic address validation - you might want to adjust this based on your specific needs
        if (address.match(/^0x[a-fA-F0-9]{40}$/)) {
            valid.push({ address, timestamp: Date.now() });
        } else {
            invalid.push(address);
        }
    });
    
    return { valid, invalid };
};
