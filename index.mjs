import robot from "./index.js";

export const screen = robot.screen;
export const desktop = robot.desktop;

export const setKeyboardDelay = robot.setKeyboardDelay;
export const keyTap = robot.keyTap;
export const keyToggle = robot.keyToggle;
export const unicodeTap = robot.unicodeTap;
export const typeString = robot.typeString;
export const typeStringDelayed = robot.typeStringDelayed;
export const setMouseDelay = robot.setMouseDelay;
export const updateScreenMetrics = robot.updateScreenMetrics;
export const moveMouse = robot.moveMouse;
export const moveMouseSmooth = robot.moveMouseSmooth;
export const mouseClick = robot.mouseClick;
export const mouseToggle = robot.mouseToggle;
export const dragMouse = robot.dragMouse;
export const scrollMouse = robot.scrollMouse;
export const getMousePos = robot.getMousePos;
export const getPixelColor = robot.getPixelColor;
export const getScreenSize = robot.getScreenSize;
export const getDesktopState = robot.getDesktopState;
export const focusWindow = robot.focusWindow;

export default robot;
