declare module "qrcode" {
    export function toCanvas(
        canvasElement: HTMLCanvasElement,
        text: string,
        options?: {
            width?: number;
            margin?: number;
            color?: {
                dark?: string;
                light?: string;
            };
        },
    ): Promise<void>;

    export function toDataURL(text: string, options?: object): Promise<string>;
}
