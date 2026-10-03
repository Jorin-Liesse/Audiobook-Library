declare module "jsmediatags/dist/jsmediatags.min.js" {
  interface Tags {
    artist?: string;
    picture?: { data: number[]; format?: string };
  }
  const mediaTags: {
    read(
      file: File | string,
      callbacks: {
        onSuccess: (result: { tags: Tags }) => void;
        onError: () => void;
      },
    ): void;
  };
  export default mediaTags;
}
