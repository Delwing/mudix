import xterm256 from "./xterm256";

export const colorCodes = {
    xterm: xterm256 as string[],
    ansi: {
        bright: ["#555555", "#ff5555", "#55ff55", "#ffff55", "#5555ff", "#ff55ff", "#55ffff", "#ffffff"],
        dark:   ["#000000", "#bb0000", "#00bb00", "#bbbb00", "#0000bb", "#bb00bb", "#00bbbb", "#bbbbbb"],
    },
};
