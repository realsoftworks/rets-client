import { expect } from 'chai';

// Import the compiled JS files
const retsParsing = require('../dist/utils/retsParsing');
const errors = require('../dist/utils/errors');

describe('retsParsing', () => {
  describe('getSimpleParser', () => {
    it('should handle complete XML without error on stream end', (done) => {
      const retsContext = { retsMethod: 'login' };
      let errorCalled = false;
      let errorMessage = '';
      
      const parser = retsParsing.getSimpleParser(retsContext, (err: any) => {
        errorCalled = true;
        errorMessage = err.message;
      });
      
      // Simulate what auth.coffee does
      parser.parser.on('closetag', (name: string) => {
        if (name === 'RETS') {
          parser.finish();
        }
      });
      
      // Simulate a complete login response
      parser.parser.write('<RETS ReplyCode="0" ReplyText="Success">');
      parser.parser.write('<RETS-RESPONSE>');
      parser.parser.write('MemberName=TestUser');
      parser.parser.write('</RETS-RESPONSE>');
      parser.parser.write('</RETS>');
      parser.parser.end();
      
      // Give it a moment to process
      setTimeout(() => {
        if (errorCalled) {
          console.log('Error was called with:', errorMessage);
        }
        expect(errorCalled).to.be.false;
        expect(parser.status).to.exist;
        expect(parser.status.replyCode).to.equal('0');
        done();
      }, 10);
    });
    
    it('should parse valid RETS response', (done) => {
      const retsContext = { retsMethod: 'test' };
      let errorCalled = false;
      
      const parser = retsParsing.getSimpleParser(retsContext, () => {
        errorCalled = true;
      });
      
      parser.parser.write('<RETS ReplyCode="0" ReplyText="Success">');
      parser.parser.write('<TEST>data</TEST>');
      parser.parser.write('</RETS>');
      
      expect(errorCalled).to.be.false;
      expect(parser.status).to.deep.equal({
        replyCode: '0',
        replyTag: 'OPERATION_SUCCESSFUL',
        replyText: 'Success'
      });
      
      parser.finish();
      done();
    });
    
    it('should handle RETS error response', (done) => {
      const retsContext = { retsMethod: 'test' };
      let capturedError: any = null;
      
      const parser = retsParsing.getSimpleParser(retsContext, (err: any) => {
        capturedError = err;
      });
      
      parser.parser.write('<RETS ReplyCode="20203" ReplyText="Unauthorized">');
      parser.parser.write('</RETS>');
      
      expect(capturedError).to.be.instanceOf(errors.RetsReplyError);
      expect(capturedError.replyCode).to.equal('20203');
      expect(capturedError.replyText).to.equal('Unauthorized');
      
      done();
    });
    
    it('should handle non-RETS XML', (done) => {
      const retsContext = { retsMethod: 'test' };
      let capturedError: any = null;
      
      const parser = retsParsing.getSimpleParser(retsContext, (err: any) => {
        capturedError = err;
      });
      
      parser.parser.write('<OTHER>not rets</OTHER>');
      
      expect(capturedError).to.be.instanceOf(errors.RetsProcessingError);
      expect(capturedError.message).to.include('Unexpected results');
      
      done();
    });
    
    it('should handle malformed XML', (done) => {
      const retsContext = { retsMethod: 'test' };
      let capturedError: any = null;
      
      const parser = retsParsing.getSimpleParser(retsContext, (err: any) => {
        capturedError = err;
        done();
      });
      
      parser.parser.write('<RETS><unclosed');
      parser.parser.end();
      
      setTimeout(() => {
        expect(capturedError).to.be.instanceOf(errors.RetsProcessingError);
        expect(capturedError.message).to.include('XML parsing error');
        if (!capturedError) done();
      }, 10);
    });
  });
  
  describe('getStreamParser', () => {
    it('should parse search results with COLUMNS and DATA', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const statusChunk = results.find(r => r.type === 'status');
        expect(statusChunk).to.exist;
        expect(statusChunk.payload.replyCode).to.equal('0');
        
        const columnsChunk = results.find(r => r.type === 'columns');
        expect(columnsChunk).to.exist;
        expect(columnsChunk.payload).to.deep.equal(['', 'ListingID', 'Price', 'Address', '']);
        
        const dataChunks = results.filter(r => r.type === 'data');
        expect(dataChunks).to.have.length(2);
        expect(dataChunks[0].payload).to.deep.equal({
          ListingID: '123',
          Price: '250000',
          Address: '123 Main St'
        });
        expect(dataChunks[1].payload).to.deep.equal({
          ListingID: '456',
          Price: '350000',
          Address: '456 Oak Ave'
        });
        
        done();
      });
      
      // Simulate RETS search response
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>	ListingID	Price	Address	</COLUMNS>
<DATA>	123	250000	123 Main St	</DATA>
<DATA>	456	350000	456 Oak Ave	</DATA>
</RETS>`);
      streamContext.parser.end();
    });
    
    it('should handle metadata parsing', (done) => {
      const retsContext = { 
        retsMethod: 'metadata',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, 'METADATA-TABLE', false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const metadataStartChunk = results.find(r => r.type === 'metadataStart');
        expect(metadataStartChunk).to.exist;
        expect(metadataStartChunk.payload.Resource).to.equal('Property');
        
        const metadataEndChunk = results.find(r => r.type === 'metadataEnd');
        expect(metadataEndChunk).to.exist;
        expect(metadataEndChunk.payload).to.equal(1);
        
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<METADATA-TABLE Resource="Property" Class="Residential">
<DELIMITER value="09"/>
<COLUMNS>	SystemName	StandardName	</COLUMNS>
<DATA>	ListPrice	ListPrice	</DATA>
</METADATA-TABLE>
</RETS>`);
      streamContext.parser.end();
    });
    
    it('should handle COUNT records', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const countChunk = results.find(r => r.type === 'count');
        expect(countChunk).to.exist;
        expect(countChunk.payload).to.equal(42);
        
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<COUNT Records="42"/>
</RETS>`);
      streamContext.parser.end();
    });
    
    it('should handle raw data mode', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, true);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const columnsChunk = results.find(r => r.type === 'columns');
        expect(columnsChunk).to.exist;
        expect(columnsChunk.payload).to.equal('\tListingID\tPrice\t');
        
        const dataChunks = results.filter(r => r.type === 'data');
        expect(dataChunks).to.have.length(1);
        expect(dataChunks[0].payload).to.equal('\t123\t250000\t');
        
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>	ListingID	Price	</COLUMNS>
<DATA>	123	250000	</DATA>
</RETS>`);
      streamContext.parser.end();
    });
    
    it('should handle MAXROWS', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const doneChunk = results.find(r => r.type === 'done');
        expect(doneChunk).to.exist;
        expect(doneChunk.payload.maxRowsExceeded).to.be.true;
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>	ListingID	</COLUMNS>
<MAXROWS/>
<DATA>	123	</DATA>
</RETS>`);
      streamContext.parser.end();
    });
  });

  describe('Edge Cases and RETS Specifications', () => {
    it('should handle RETS-STATUS elements', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const statusChunks = results.filter(r => r.type === 'status');
        expect(statusChunks).to.have.length(2);
        expect(statusChunks[0].payload.replyCode).to.equal('0');
        expect(statusChunks[1].payload.replyCode).to.equal('20208');
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>	ListingID	</COLUMNS>
<DATA>	123	</DATA>
<RETS-STATUS ReplyCode="20208" ReplyText="Max Records Exceeded"/>
</RETS>`);
      streamContext.parser.end();
    });

    it('should handle NO_RECORDS_FOUND (20201) with zero count', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      let errorReceived = false;
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
        if (chunk.type === 'error') {
          errorReceived = true;
          expect(chunk.payload).to.be.instanceOf(errors.RetsReplyError);
          expect(chunk.payload.replyCode).to.equal('20201');
          const countChunks = results.filter(r => r.type === 'count');
          expect(countChunks).to.have.length(0);
          done();
        }
      });
      
      streamContext.retsStream.on('end', () => {
        if (!errorReceived) {
          done(new Error('Expected error was not received'));
        }
      });
      
      streamContext.parser.write(`<RETS ReplyCode="20201" ReplyText="No Records Found">
<COUNT Records="0"/>
</RETS>`);
      streamContext.parser.end();
    });

    it('should handle custom delimiters (pipe separator)', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const columnsChunk = results.find(r => r.type === 'columns');
        expect(columnsChunk.payload).to.deep.equal(['', 'ListingID', 'Price', '']);
        
        const dataChunks = results.filter(r => r.type === 'data');
        expect(dataChunks[0].payload).to.deep.equal({
          ListingID: '123',
          Price: '250000'
        });
        done();
      });
      
      // Using hex value 7C for pipe character
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="7C"/>
<COLUMNS>|ListingID|Price|</COLUMNS>
<DATA>|123|250000|</DATA>
</RETS>`);
      streamContext.parser.end();
    });

    it('should handle empty data fields', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const dataChunks = results.filter(r => r.type === 'data');
        expect(dataChunks[0].payload).to.deep.equal({
          ListingID: '123',
          Price: '',
          Address: '456 Oak Ave'
        });
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>	ListingID	Price	Address	</COLUMNS>
<DATA>	123		456 Oak Ave	</DATA>
</RETS>`);
      streamContext.parser.end();
    });

    it('should handle special characters in data', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const dataChunks = results.filter(r => r.type === 'data');
        expect(dataChunks[0].payload).to.deep.equal({
          ListingID: '123',
          Description: 'Beautiful home with "luxury" features & more!',
          Price: '$250,000'
        });
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>	ListingID	Description	Price	</COLUMNS>
<DATA>	123	Beautiful home with "luxury" features &amp; more!	$250,000	</DATA>
</RETS>`);
      streamContext.parser.end();
    });

    it('should handle multiline text content in DATA', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const dataChunks = results.filter(r => r.type === 'data');
        expect(dataChunks[0].payload.Description).to.include('Line 1');
        expect(dataChunks[0].payload.Description).to.include('Line 2');
        done();
      });
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>	ListingID	Description	</COLUMNS>
<DATA>	123	Line 1
Line 2
Line 3	</DATA>
</RETS>`);
      streamContext.parser.end();
    });

    it('should handle large number of columns and data', (done) => {
      const retsContext = { 
        retsMethod: 'search',
        headerInfo: { 'content-type': 'text/xml' }
      };
      
      const streamContext = retsParsing.getStreamParser(retsContext, null, false);
      const results: any[] = [];
      
      streamContext.retsStream.on('data', (chunk: any) => {
        results.push(chunk);
      });
      
      streamContext.retsStream.on('end', () => {
        const columnsChunk = results.find(r => r.type === 'columns');
        expect(columnsChunk.payload).to.have.length(52); // 50 fields + 2 empty
        
        const dataChunks = results.filter(r => r.type === 'data');
        expect(dataChunks).to.have.length(1);
        expect(dataChunks[0].payload.Field1).to.equal('Value1');
        expect(dataChunks[0].payload.Field50).to.equal('Value50');
        done();
      });
      
      // Generate 50 columns and corresponding data
      const columns = [''];
      const values = [''];
      for (let i = 1; i <= 50; i++) {
        columns.push(`Field${i}`);
        values.push(`Value${i}`);
      }
      columns.push('');
      values.push('');
      
      streamContext.parser.write(`<RETS ReplyCode="0" ReplyText="Success">
<DELIMITER value="09"/>
<COLUMNS>${columns.join('\t')}</COLUMNS>
<DATA>${values.join('\t')}</DATA>
</RETS>`);
      streamContext.parser.end();
    });

    it('should handle encoding with different parser encoding', (done) => {
      const retsContext = { retsMethod: 'test' };
      let errorCalled = false;
      
      const parser = retsParsing.getSimpleParser(retsContext, () => {
        errorCalled = true;
      }, 'ISO-8859-1');
      
      parser.parser.write('<RETS ReplyCode="0" ReplyText="Success">');
      parser.parser.write('<TEST>data</TEST>');
      parser.parser.write('</RETS>');
      
      expect(errorCalled).to.be.false;
      expect(parser.status.replyCode).to.equal('0');
      
      parser.finish();
      done();
    });

    it('should handle parser cleanup on multiple finish calls', (done) => {
      const retsContext = { retsMethod: 'test' };
      let errorCallCount = 0;
      
      const parser = retsParsing.getSimpleParser(retsContext, () => {
        errorCallCount++;
      });
      
      parser.parser.write('<RETS ReplyCode="0" ReplyText="Success">');
      parser.parser.write('</RETS>');
      
      // Call finish multiple times
      parser.finish();
      parser.finish();
      parser.finish();
      
      // Should not have triggered error callback
      expect(errorCallCount).to.equal(0);
      done();
    });

    it('should handle rapid successive parsing operations', (done) => {
      let completedParsers = 0;
      const totalParsers = 10;
      
      for (let i = 0; i < totalParsers; i++) {
        const retsContext = { retsMethod: `test${i}` };
        const parser = retsParsing.getSimpleParser(retsContext, () => {
          // Should not be called for successful parsing
        });
        
        parser.parser.write(`<RETS ReplyCode="0" ReplyText="Success ${i}">`);
        parser.parser.write(`<TEST>data${i}</TEST>`);
        parser.parser.write('</RETS>');
        
        expect(parser.status.replyText).to.equal(`Success ${i}`);
        parser.finish();
        
        completedParsers++;
        if (completedParsers === totalParsers) {
          done();
        }
      }
    });
  });
});