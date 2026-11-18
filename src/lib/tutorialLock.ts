/** True while the guided tour is running: app dialogs then ignore backdrop clicks and Escape, so nothing closes by accident. */
let active = false;
export const setTutorialActive = (v: boolean) => {
  active = v;
};
export const isTutorialActive = () => active;
