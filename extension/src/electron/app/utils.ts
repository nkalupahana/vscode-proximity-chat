const POSIX_PATH_SEP = "/";

export function getPathDistance(path1: string, path2: string): number {
    // Split paths into segments and filter out empty strings
    const segments1 = path1.split(POSIX_PATH_SEP).filter(Boolean);
    const segments2 = path2.split(POSIX_PATH_SEP).filter(Boolean);

    // Find the index where the paths diverge
    let commonDepth = 0;
    while (
        commonDepth < segments1.length && 
        commonDepth < segments2.length && 
        segments1[commonDepth] === segments2[commonDepth]
    ) {
        commonDepth++;
    }

    // Steps to go up from path1 to the common ancestor
    const stepsUp = segments1.length - commonDepth;
    
    // Steps to go down from the common ancestor to path2
    const stepsDown = segments2.length - commonDepth;

    return Math.max(stepsUp + stepsDown - 1, 0);
}

export function getVolume(path1: string, path2: string): number {
    const distance = getPathDistance(path1, path2);
    const DISTANCE_TO_VOLUME = {
        0: 1,
        1: 0.5,
        2: 0.1
    } as Record<number, number>;
    return DISTANCE_TO_VOLUME[distance] ?? 0;
}