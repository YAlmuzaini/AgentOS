import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";

/**
 * Object storage behind an interface (RECIPE A2): MinIO locally, Cloudflare R2
 * in production, same code. Agents never get these credentials — every read or
 * write goes through the ACL in FilesService.
 */
@Injectable()
export class ObjectStorage implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      // MinIO and R2 both want path-style addressing.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`created bucket ${this.bucket}`);
      } catch (error) {
        // Storage being unreachable must not stop the control plane; the file
        // routes fail loudly on use instead.
        this.logger.warn(`object storage unavailable: ${String(error)}`);
      }
    }
  }

  async put(key: string, body: string | Uint8Array, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }),
    );
  }

  async get(key: string): Promise<string | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return (await result.Body?.transformToString()) ?? null;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
