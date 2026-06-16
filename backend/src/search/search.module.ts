import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { StartupIndiaProvider } from './providers/startupindia.provider';
import { McaProvider } from './providers/mca.provider';
import { GoogleProvider } from './providers/google.provider';
import { WikiProvider } from './providers/wiki.provider';
import { WebsiteProvider } from './providers/website.provider';
import { ContactProvider } from './providers/contact.provider';
import { AggregatorProvider } from './providers/aggregator.provider';
import { TracxnProvider } from './providers/tracxn.provider';
import { GroqProvider } from './providers/groq.provider';

@Module({
  providers: [
    SearchService,
    StartupIndiaProvider,
    McaProvider,
    GoogleProvider,
    WikiProvider,
    WebsiteProvider,
    ContactProvider,
    AggregatorProvider,
    TracxnProvider,
    GroqProvider,
  ],
  exports: [SearchService, StartupIndiaProvider],
})
export class SearchModule {}
