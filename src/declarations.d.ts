declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.gif';
declare module '*.mp3';
declare module '*.shadow.css' {
  const content: string;
  export default content;
}

declare const process: { env: Record<string, string | undefined> };
