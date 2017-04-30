/*
 * Copyright (c) 2017 VMware Inc. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

package org.hiero.sketch;

import com.google.common.net.HostAndPort;
import org.hiero.dataset.LocalDataSet;
import org.hiero.dataset.ParallelDataSet;
import org.hiero.dataset.RemoteDataSet;
import org.hiero.dataset.api.*;
import org.hiero.remoting.HieroServer;
import org.hiero.utils.Converters;
import org.junit.AfterClass;
import org.junit.BeforeClass;
import org.junit.Test;
import rx.Observable;
import rx.observers.TestSubscriber;

import javax.annotation.Nullable;
import java.util.ArrayList;

import static junit.framework.TestCase.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.fail;

/**
 * Remoting tests for Akka.
 */
public class RemotingTest {
    private final static HostAndPort serverAddress = HostAndPort.fromParts("127.0.0.1",
                                                                           1234);
    @Nullable private static HieroServer server;

    private static class IncrementMap implements IMap<int[], int[]> {
        @Override
        public int[] apply(final int[] data) {
            if (data.length == 0) {
                throw new RuntimeException("Cannot apply map against empty data");
            }

            final int[] dataNew = new int[data.length];
            for (int i = 0; i < data.length; i++) {
                dataNew[i] = data[i] + 1;
            }

            return dataNew;
        }
    }

    private static class SumSketch implements ISketch<int[], Integer> {
        @Override @Nullable
        public Integer zero() {
            return 0;
        }

        @Override @Nullable
        public Integer add(@Nullable final Integer left, @Nullable final Integer right) {
            return Converters.checkNull(left) + Converters.checkNull(right);
        }

        @Override
        public Integer create(final int[] data) {
            int sum = 0;
            for (int d : data) sum += d;
            return sum;
        }
    }

    private static class ErrorSumSketch implements ISketch<int[], Integer> {
        @Override @Nullable
        public Integer zero() {
            return 0;
        }

        @Override @Nullable
        public Integer add(@Nullable final Integer left, @Nullable final Integer right) {
            return Converters.checkNull(left) + Converters.checkNull(right);
        }

        @Override
        public Integer create(final int[] data) {
            throw new RuntimeException("ErrorSumSketch");
        }
    }

    /*
     * Create separate server and client actor systems to test remoting.
     */
    @BeforeClass
    public static void initialize() throws Exception {
        // Server
        final int parts = 10;
        final int size = 1000;
        ArrayList<IDataSet<int[]>> al = new ArrayList<IDataSet<int[]>>(10);
        for (int i=0; i < parts; i++) {
            final int[] data = new int[size];
            for (int j = 0; j < size; j++)
                data[j] = (i * size) + j;
            LocalDataSet<int[]> lds = new LocalDataSet<>(data);
            al.add(lds);
        }
        ParallelDataSet<int[]> pds = new ParallelDataSet<int[]>(al);
        pds.setBundleInterval(0);
        server = new HieroServer(serverAddress, pds);
    }

    @Test
    public void testMapSketchThroughClient() {
        final IDataSet<int[]> remoteIds = new RemoteDataSet<int[]>(serverAddress);
        final IDataSet<int[]> remoteIdsNew = remoteIds.map(new IncrementMap())
                                                      .filter(p -> p.deltaValue != null)
                                                      .toBlocking()
                                                      .last().deltaValue;
        assertNotNull(remoteIdsNew);
        final int result = remoteIdsNew.sketch(new SumSketch())
                                       .map(e -> e.deltaValue)
                                       .reduce((x, y) -> x + y)
                                       .toBlocking()
                                       .last();
        assertEquals(50005000, result);
    }


    @Test
    public void testMapSketchThroughClientWithError() {
        final IDataSet<int[]> remoteIds = new RemoteDataSet<int[]>(serverAddress);
        final IDataSet<int[]> remoteIdsNew = remoteIds.map(new IncrementMap())
                                                      .toBlocking()
                                                      .last().deltaValue;
        assertNotNull(remoteIdsNew);
        final Observable<PartialResult<Integer>> resultObs =
                remoteIdsNew.sketch(new ErrorSumSketch());
        TestSubscriber<PartialResult<Integer>> ts = new TestSubscriber<PartialResult<Integer>>();
        resultObs.toBlocking().subscribe(ts);
        ts.assertError(RuntimeException.class);
    }

    @Test
    public void testUnsubscribe() {
        final IDataSet<int[]> remoteIds = new RemoteDataSet<int[]>(serverAddress);
        final Observable<PartialResult<Integer>> resultObs = remoteIds.sketch(new SumSketch());
        TestSubscriber<PartialResult<Integer>> ts =
                new TestSubscriber<PartialResult<Integer>>() {
                    private int counter = 0;

                    @Override
                    public void onNext(final PartialResult<Integer> pr) {
                        this.counter++;
                        super.onNext(pr);
                        if (this.counter == 3)
                            this.unsubscribe();
                    }
                };

        resultObs.toBlocking().subscribe(ts);
        ts.assertValueCount(3);
        ts.assertNotCompleted();
    }

    @Test
    public void testZip() {
        final IDataSet<int[]> remoteIds = new RemoteDataSet<int[]>(serverAddress);
        final IDataSet<int[]> remoteIdsLeft = Converters.checkNull(
                remoteIds.map(new IncrementMap()).toBlocking().last().deltaValue);
        final IDataSet<int[]> remoteIdsRight = Converters.checkNull(
                remoteIds.map(new IncrementMap()).toBlocking().last().deltaValue);
        final PartialResult<IDataSet<Pair<int[], int[]>>> last
                = Converters.checkNull(remoteIdsLeft.zip(remoteIdsRight)).toBlocking().last();
        assertNotNull(last);
        assertEquals(last.deltaDone, 1.0, 0.001);
    }

    @Test
    public void testIncorrectRemoteIndex() {
        try {
            // Should not succeed because the remote handle does not exist
            int nonExistentIndex = 99;
            final IDataSet<int[]> remoteIds = new RemoteDataSet<int[]>(serverAddress,
                                                                       nonExistentIndex);
            final IDataSet<int[]> oneMap = Converters.checkNull(
                    remoteIds.map(new IncrementMap()).toBlocking().last().deltaValue);
            fail();
        }
        catch (RuntimeException ignored) {
        }
        try {
            // Test with zip
            final IDataSet<int[]> remoteIdsLeft = new RemoteDataSet<int[]>(serverAddress);
            final IDataSet<int[]> remoteIdsRight = new RemoteDataSet<int[]>(serverAddress, 99);
            final PartialResult<IDataSet<Pair<int[], int[]>>> last
                    = Converters.checkNull(remoteIdsLeft.zip(remoteIdsRight)).toBlocking().last();
            fail();
        } catch (RuntimeException ignored) {
        }
    }

    @AfterClass
    public static void shutdown() {
        if (server != null) {
            server.shutdown();
        }
    }
}