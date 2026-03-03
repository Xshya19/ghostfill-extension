declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.svg";
declare module "*.gif";

interface WeakRef<T> {
    readonly ref: T | undefined;
    deref(): T | undefined;
}
